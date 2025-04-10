import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import idl from "../target/idl/battle_memecoin_club.json";
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
  .option('matchid', {
    alias: 'm',
    description: 'Match ID',
    type: 'string',
    default: 'MATCH_001'
  })
  .option('winners', {
    alias: 'w',
    description: 'Comma-separated list of winner public keys to claim prizes for',
    type: 'string',
    default: ''
  })
  .help()
  .alias('help', 'h')
  .parse();

async function main() {
  // ensure environment variables are set
  if (!process.env.ANCHOR_PROVIDER_URL) {
    process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";
  }
  
  // Set up wallet path using os.homedir() to avoid tilde (~) issues
  const defaultWalletPath = path.join(os.homedir(), '.config', 'solana', 'arena-authority.json');
  
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
        console.error("Error: Program is currently paused. Cannot claim prizes.");
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
    
    // Check if match ID matches
    if (matchData.matchId !== argv.matchid) {
      console.error(`Error: Match ID mismatch. The match account has ID "${matchData.matchId}" but you specified "${argv.matchid}"`);
      process.exit(1);
    }
    
    // Check if match is in Completed state
    const currentStatus = Object.keys(matchData.status)[0];
    if (currentStatus !== 'completed') {
      console.error(`Error: Match is not in "Completed" state. Current state: ${currentStatus}`);
      if (currentStatus === 'battle') {
        console.log(`Tip: End the match first:`);
        console.log(`npm run end-match -- --matchaccount ${matchAccount.toString()} --matchid ${argv.matchid} --winner <FIGHTER_NAME>`);
      } else if (currentStatus === 'refund') {
        console.log(`This match is in "Refund" state. Use claim-refund instead of claim-prize:`);
        console.log(`npm run claim-refund -- --matchaccount ${matchAccount.toString()} --matchid ${argv.matchid}`);
        console.log(`npm run close-match -- --matchaccount ${matchAccount.toString()} --matchid ${argv.matchid}`);
      }
      process.exit(1);
    }
    
    // Make sure winner is set
    if (!matchData.winner) {
      console.error(`Error: Match has no winner set.`);
      process.exit(1);
    }
    
    console.log(`Preparing to claim prizes for match ${argv.matchid} (${matchAccount.toString()})`);
    console.log(`Match winner is: ${matchData.winner}`);
    
    // Get winners from command line or from match data
    let winnerAccounts = [];
    
    if (argv.winners && argv.winners.trim() !== '') {
      // Parse comma-separated winners from command line
      const specifiedWinners = argv.winners.split(',').map(addr => {
        try {
          return new PublicKey(addr.trim());
        } catch (e) {
          console.error(`Invalid public key: ${addr.trim()}`);
          process.exit(1);
        }
      });
      
      winnerAccounts = specifiedWinners.map(pubkey => ({
        pubkey,
        isWritable: true,
        isSigner: false
      }));
      
      console.log(`Processing prizes for ${winnerAccounts.length} specified winners.`);
    } else {
      // Get all winners from match data
      winnerAccounts = matchData.bets
        .filter(bet => !bet.claimed && bet.fighter === matchData.winner)
        .map(bet => ({
          pubkey: new PublicKey(bet.bettor),
          isWritable: true,
          isSigner: false
        }));
      
      console.log(`Processing prizes for all ${winnerAccounts.length} unclaimed winners.`);
    }
    
    if (winnerAccounts.length === 0) {
      console.log("No winners to process prizes for.");
      process.exit(0);
    }
    
    // Log winners being processed
    for (const account of winnerAccounts) {
      console.log(`- ${account.pubkey.toString()}`);
    }
    
    // Execute claim prize transaction
    console.log(`\nClaiming prizes for match ${argv.matchid}...`);
    
    const tx = await program.methods
      .claimPrize(argv.matchid)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        treasury: process.env.TREASURY_WALLET,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(winnerAccounts)
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log("Successfully processed prizes. Check balances of winners to confirm.");
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("MatchNotCompleted")) {
      console.error("The match is not in 'Completed' state. Make sure to end the match first with 'npm run end-match'.");
    } else if (error.toString().includes("InvalidMatchId")) {
      console.error("The match ID does not match. Make sure you're using the correct match ID.");
    } else if (error.toString().includes("InvalidRemainingAccounts")) {
      console.error("Invalid winner accounts. Make sure the provided public keys are valid winners of this match.");
    } else if (error.toString().includes("ProgramPaused")) {
      console.error("The program is currently paused. Unpause it using 'npm run set-pause-state -- --paused false'.");
    } else if (error.toString().includes("Unauthorized")) {
      console.error("You are not authorized to claim prizes. Only the program authority can do this.");
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 