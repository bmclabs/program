import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import idl from "../target/idl/battle_memecoin.json";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('matchaccount', {
    alias: 'a',
    description: 'Match account public key',
    type: 'string',
    demandOption: true
  })
  .option('status', {
    alias: 's',
    description: 'New match status',
    type: 'string',
    choices: ['Battle'],
    default: 'Battle'
  })
  .help()
  .alias('help', 'h')
  .parse();

async function main() {
  // Ensure environment variables are set
  if (!process.env.ANCHOR_PROVIDER_URL) {
    process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";
  }
  
  // Set up wallet path using os.homedir() to avoid tilde (~) issues
  const defaultWalletPath = path.join(os.homedir(), '.config', 'solana', 'test-authority.json');
  
  // Check if wallet file exists
  if (!fs.existsSync(defaultWalletPath)) {
    console.log(`Wallet file not found at ${defaultWalletPath}. Please run 'npm run setup' first.`);
    process.exit(1);
  }
  
  // Set wallet path
  process.env.ANCHOR_WALLET = defaultWalletPath;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as any, provider);
  
  try {
    // Use match account from command line args
    const matchAccount = new PublicKey(argv.matchaccount);
    
    // Find PDA for house wallet
    const [houseWallet] = await PublicKey.findProgramAddress(
      [Buffer.from("house")],
      program.programId
    );
    
    // Check if house wallet is paused
    const houseInfo = await provider.connection.getAccountInfo(houseWallet);
    if (houseInfo) {
      const houseData = program.coder.accounts.decode('houseWallet', houseInfo.data);
      if (houseData.paused) {
        console.error("Error: Program is currently paused. Cannot update match status.");
        console.log("To unpause: npm run set-pause-state -- --paused false");
        process.exit(1);
      }
    }
    
    // Fetch match data
    const accountInfo = await provider.connection.getAccountInfo(matchAccount);
    if (!accountInfo) {
      console.error(`Error: Match account not found at ${matchAccount.toString()}`);
      process.exit(1);
    }
    
    // Decode the account data
    const matchData = program.coder.accounts.decode('matchAccount', accountInfo.data);
    
    console.log(`Match data:`);
    console.log(`- Match ID: ${matchData.matchId}`);
    console.log(`- Fighter 1: ${matchData.fighter1}`);
    console.log(`- Fighter 2: ${matchData.fighter2}`);
    console.log(`- Current status: ${Object.keys(matchData.status)[0]}`);
    
    // Check if status update is valid - must be from preparation to battle per lib.rs
    const currentStatus = Object.keys(matchData.status)[0];
    
    if (currentStatus !== 'preparation') {
      console.error(`Error: Cannot update status. Match must be in 'Preparation' state to be updated to 'Battle'. Current state: ${currentStatus}`);
      if (currentStatus === 'battle') {
        console.log(`Match is already in 'Battle' state.`);
        console.log(`\nNext step: End the match when ready:`);
        console.log(`npm run end-match -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId} --winner <FIGHTER_NAME>`);
      } else if (currentStatus === 'completed') {
        console.log(`Match is already in 'Completed' state.`);
        console.log(`\nNext step: Claim prizes for winners:`);
        console.log(`npm run claim-prize -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId}`);
      } else if (currentStatus === 'refund') {
        console.log(`Match is in 'Refund' state.`);
        console.log(`\nNext step: Claim refunds for bettors:`);
        console.log(`npm run claim-refund -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId}`);
      }
      process.exit(1);
    }
    
    if (argv.status.toLowerCase() === currentStatus.toLowerCase()) {
      console.log(`Status is already set to '${argv.status}'. No change needed.`);
      process.exit(0);
    }
    
    console.log(`Updating match status to ${argv.status} for match ${matchAccount.toString()}`);
    
    // Update match status - only Battle is valid per lib.rs
    const tx = await program.methods
      .updateMatchStatus(argv.status)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        authority: provider.wallet.publicKey,
      })
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log(`Match status updated to ${argv.status}`);
    
    // Suggest next steps
    console.log(`\nNext step: End the match when ready:`);
    console.log(`npm run end-match -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId} --winner <FIGHTER_NAME>`);
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("InvalidStatus")) {
      console.error("Invalid status. Per the smart contract, only 'Battle' is a valid status to set with updateMatchStatus.");
    } else if (error.toString().includes("InvalidStateTransition")) {
      console.error("Invalid state transition. Match must be in 'Preparation' state to update to 'Battle'.");
    } else if (error.toString().includes("ProgramPaused")) {
      console.error("The program is currently paused. Unpause it using 'npm run set-pause-state -- --paused false'.");
    } else if (error.toString().includes("Unauthorized")) {
      console.error("You are not authorized to update match status. Only the program authority can do this.");
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
