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
    
    // Find PDA for house wallet
    const [houseWallet] = await PublicKey.findProgramAddress(
      [Buffer.from("house")],
      program.programId
    );
    
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
    
    // Check if match is in Completed or Refund state
    const currentStatus = Object.keys(matchData.status)[0];
    if (currentStatus !== 'completed' && currentStatus !== 'refund') {
      console.error(`Error: Match is not in a finalized state. Current state: ${currentStatus}`);
      console.log(`Note: Only matches in "Completed" or "Refund" state can be closed.`);
      process.exit(1);
    }
    
    // Check if all prizes/refunds have been claimed
    let unclaimedCount = 0;
    if (currentStatus === 'completed') {
      const winnerFighter = matchData.winner;
      unclaimedCount = matchData.bets.filter(bet => 
        !bet.claimed && bet.fighter === winnerFighter
      ).length;
      
      if (unclaimedCount > 0) {
        console.error(`Error: There are ${unclaimedCount} unclaimed prizes. All prizes must be claimed before closing the match.`);
        process.exit(1);
      }
    } else if (currentStatus === 'refund') {
      unclaimedCount = matchData.bets.filter(bet => !bet.claimed).length;
      
      if (unclaimedCount > 0) {
        console.error(`Error: There are ${unclaimedCount} unclaimed refunds. All refunds must be claimed before closing the match.`);
        process.exit(1);
      }
    }
    
    console.log(`Preparing to close match account ${argv.matchid} (${matchAccount.toString()})`);
    console.log(`Current match status: ${currentStatus}`);
    console.log(`All bets claimed: ${unclaimedCount === 0 ? 'Yes' : 'No'}`);
    
    // Execute close match account transaction
    console.log(`\nClosing match account...`);
    
    const tx = await program.methods
      .closeMatchAccount(argv.matchid)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log("Successfully closed match account and reclaimed rent.");
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("MatchNotFinalized")) {
      console.error("The match is not in a finalized state. It must be in 'Completed' or 'Refund' state.");
    } else if (error.toString().includes("UnclaimedPrizes")) {
      console.error("There are unclaimed prizes. All prizes must be claimed before closing the match.");
    } else if (error.toString().includes("UnclaimedRefunds")) {
      console.error("There are unclaimed refunds. All refunds must be claimed before closing the match.");
    } else if (error.toString().includes("InvalidMatchId")) {
      console.error("The match ID does not match. Make sure you're using the correct match ID.");
    } else if (error.toString().includes("Unauthorized")) {
      console.error("You are not authorized to close this match account. Only the program authority can do this.");
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 