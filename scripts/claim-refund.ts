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
  .option('bettors', {
    alias: 'b',
    description: 'Comma-separated list of bettor public keys to process refunds for',
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
  const defaultWalletPath = path.join(os.homedir(), '.config', 'solana', 'authority-test.json');
  
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
        console.error("Error: Program is currently paused. Cannot process refunds.");
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
    
    // Check if match is in Refund state
    const currentStatus = Object.keys(matchData.status)[0];
    if (currentStatus !== 'refund') {
      console.error(`Error: Match is not in "Refund" state. Current state: ${currentStatus}`);
      console.log(`Note: Only matches in "Refund" state can have refunds processed.`);
      process.exit(1);
    }
    
    console.log(`Preparing to claim refunds for match ${argv.matchid} (${matchAccount.toString()})`);
    
    // Get bettors from command line or from match data
    let bettorAccounts = [];
    
    if (argv.bettors && argv.bettors.trim() !== '') {
      // Parse comma-separated bettors from command line
      const specifiedBettors = argv.bettors.split(',').map(addr => {
        try {
          return new PublicKey(addr.trim());
        } catch (e) {
          console.error(`Invalid public key: ${addr.trim()}`);
          process.exit(1);
        }
      });
      
      bettorAccounts = specifiedBettors.map(pubkey => ({
        pubkey,
        isWritable: true,
        isSigner: false
      }));
      
      console.log(`Processing refunds for ${bettorAccounts.length} specified bettors.`);
    } else {
      // Get all bettors from match data
      bettorAccounts = matchData.bets
        .filter(bet => !bet.claimed)
        .map(bet => ({
          pubkey: new PublicKey(bet.bettor),
          isWritable: true,
          isSigner: false
        }));
      
      console.log(`Processing refunds for all ${bettorAccounts.length} unclaimed bettors.`);
    }
    
    if (bettorAccounts.length === 0) {
      console.log("No bettors to process refunds for.");
      process.exit(0);
    }
    
    // Log bettors being processed
    for (const account of bettorAccounts) {
      console.log(`- ${account.pubkey.toString()}`);
    }
    
    // Execute claim refund transaction
    console.log(`\nClaiming refunds for match ${argv.matchid}...`);
    
    const tx = await program.methods
      .claimRefund(argv.matchid)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(bettorAccounts)
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log("Successfully processed refunds. Check balances of bettors to confirm.");
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("NotRefundable")) {
      console.error("The match is not in 'Refund' state. This match might not be refundable.");
    } else if (error.toString().includes("InvalidMatchId")) {
      console.error("The match ID does not match. Make sure you're using the correct match ID.");
    } else if (error.toString().includes("InvalidRemainingAccounts")) {
      console.error("Invalid bettor accounts. Make sure the provided public keys are valid bettors of this match.");
    } else if (error.toString().includes("ProgramPaused")) {
      console.error("The program is currently paused. Unpause it using 'npm run set-pause-state -- --paused false'.");
    } else if (error.toString().includes("Unauthorized")) {
      console.error("You are not authorized to process refunds. Only the program authority can do this.");
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 