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
  .option('bettor', {
    alias: 'b',
    description: 'Public key of the bettor to reclaim prize for',
    type: 'string',
    demandOption: true
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
    
    // Parse bettor public key
    let bettorPubkey;
    try {
      bettorPubkey = new PublicKey(argv.bettor);
    } catch (e) {
      console.error(`Error: Invalid bettor public key format: ${argv.bettor}`);
      process.exit(1);
    }
    
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
        console.error("Error: Program is currently paused. Cannot reclaim prize.");
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
        console.log(`npm run close-match -- --matchaccount ${matchAccount.toString()} --matchid ${argv.matchid}`);
      } else if (currentStatus === 'refund') {
        console.log(`This match is in "Refund" state. Use claim-refund instead of reclaim-prize:`);
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
    
    console.log(`Preparing to reclaim prize for match ${argv.matchid} (${matchAccount.toString()})`);
    console.log(`Match winner is: ${matchData.winner}`);
    console.log(`Bettor: ${bettorPubkey.toString()}`);
    
    // Find the specific bettor in the bet list
    const bettorBet = matchData.bets.find(bet => 
      !bet.claimed && 
      bet.fighter === matchData.winner && 
      bet.bettor.toString() === bettorPubkey.toString()
    );
    
    if (!bettorBet) {
      console.error(`Error: Bettor ${bettorPubkey.toString()} either does not have an unclaimed bet or did not bet on the winning fighter.`);
      process.exit(1);
    }
    
    const betAmount = bettorBet.amount / anchor.web3.LAMPORTS_PER_SOL;
    console.log(`Bettor has an unclaimed bet of ${betAmount} SOL on ${bettorBet.fighter}`);
    
    // Add bettor to remaining accounts
    const remainingAccounts = [{
      pubkey: bettorPubkey,
      isWritable: true,
      isSigner: false
    }];
    
    // Execute reclaim prize transaction
    console.log(`\nReclaiming prize for bettor ${bettorPubkey.toString()}...`);
    
    const tx = await program.methods
      .reclaimPrize(argv.matchid, bettorPubkey)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        treasury: process.env.TREASURY_WALLET,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log("Successfully reclaimed prize. Check balance of bettor to confirm.");
    
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("MatchNotCompleted")) {
      console.error("The match is not in 'Completed' state. Make sure to end the match first with 'npm run end-match'.");
    } else if (error.toString().includes("InvalidMatchId")) {
      console.error("The match ID does not match. Make sure you're using the correct match ID.");
    } else if (error.toString().includes("InvalidRemainingAccounts")) {
      console.error("Invalid bettor account. Make sure the provided public key is valid.");
    } else if (error.toString().includes("ProgramPaused")) {
      console.error("The program is currently paused. Unpause it using 'npm run set-pause-state -- --paused false'.");
    } else if (error.toString().includes("Unauthorized")) {
      console.error("You are not authorized to reclaim prizes. Only the program authority can do this.");
    } else if (error.toString().includes("NoBet")) {
      console.error("No unclaimed bet found for this bettor.");
    } else if (error.toString().includes("InsufficientFunds")) {
      console.error("Insufficient funds in house wallet to pay the prize.");
    } else if (error.toString().includes("TransferFailed")) {
      console.error("Failed to transfer funds. This may be due to system issues.");
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 