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
  .option('keypair', {
    alias: 'k',
    description: 'Path to keypair file (authority)',
    type: 'string'
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
  let walletPath = path.join(os.homedir(), '.config', 'solana', 'arena-authority.json');
  
  // Use custom keypair if provided
  if (argv.keypair) {
    if (fs.existsSync(argv.keypair)) {
      walletPath = argv.keypair;
    } else {
      console.log(`Keypair file not found at ${argv.keypair}`);
      process.exit(1);
    }
  } else {
    // Check if default wallet file exists
    if (!fs.existsSync(walletPath)) {
      console.log(`Wallet file not found at ${walletPath}. Please run 'npm run setup' first.`);
      process.exit(1);
    }
  }
  
  // Set wallet path
  process.env.ANCHOR_WALLET = walletPath;

  // Create custom provider with the specified keypair
  const wallet = new anchor.Wallet(
    anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
    )
  );
  
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL),
    wallet,
    { commitment: 'confirmed' }
  );
  
  anchor.setProvider(provider);

  const program = new Program(idl as any, provider);
  
  try {
    // Parse match account pubkey
    let matchAccount;
    try {
      matchAccount = new PublicKey(argv.matchaccount);
    } catch (e) {
      console.error(`Error: Invalid match account public key format: ${argv.matchaccount}`);
      process.exit(1);
    }
    
    // Find PDA for house wallet
    const [houseWallet] = await PublicKey.findProgramAddress(
      [Buffer.from("house")],
      program.programId
    );
    
    // Check if house wallet is paused
    const houseInfo = await provider.connection.getAccountInfo(houseWallet);
    if (!houseInfo) {
      console.error(`Error: House wallet not found at ${houseWallet.toString()}`);
      console.log("Please run 'npm run initialize' first to create the house wallet.");
      process.exit(1);
    }
    
    const houseData = program.coder.accounts.decode('houseWallet', houseInfo.data);
    
    // Check if the caller is the authority
    const callerPubkey = provider.wallet.publicKey;
    if (!callerPubkey.equals(houseData.authority)) {
      console.error(`Error: The caller ${callerPubkey.toString()} is not the authority. Only authority ${houseData.authority.toString()} can perform this operation.`);
      process.exit(1);
    }
    
    // Fetch match data
    const matchAccountInfo = await provider.connection.getAccountInfo(matchAccount);
    if (!matchAccountInfo) {
      console.error(`Error: Match account not found at ${matchAccount.toString()}`);
      process.exit(1);
    }
    
    const matchData = program.coder.accounts.decode('matchAccount', matchAccountInfo.data);
    
    // Check if match ID matches
    if (matchData.matchId !== argv.matchid) {
      console.error(`Error: Match ID mismatch. The match account has ID "${matchData.matchId}" but you specified "${argv.matchid}"`);
      process.exit(1);
    }
    
    // Display match info
    const currentStatus = Object.keys(matchData.status)[0];
    
    console.log(`Match Information:`);
    console.log(`- Match ID: ${matchData.matchId}`);
    console.log(`- Fighter 1: ${matchData.fighter1}`);
    console.log(`- Fighter 2: ${matchData.fighter2}`);
    console.log(`- Status: ${currentStatus}`);
    console.log(`- Total Bets Fighter 1: ${matchData.totalBetsFighter1 / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`- Total Bets Fighter 2: ${matchData.totalBetsFighter2 / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`- Number of bets: ${matchData.bets.length}`);
    
    console.log(`\nInitiating emergency refund for match ${argv.matchid}...`);
    
    // Collect bettor accounts for all unclaimed bets
    const remainingAccounts = [];
    for (const bet of matchData.bets) {
      if (!bet.claimed) {
        remainingAccounts.push({
          pubkey: bet.bettor,
          isWritable: true,
          isSigner: false
        });
      }
    }
    
    if (remainingAccounts.length === 0) {
      console.log("No unclaimed bets found. Nothing to refund.");
      process.exit(0);
    }
    
    console.log(`Found ${remainingAccounts.length} unclaimed bets to refund.`);
    
    // Perform emergency refund
    const tx = await program.methods
      .emergencyRefund(argv.matchid)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log(`Success: Emergency refund initiated for match ${argv.matchid}.`);
    console.log(`All eligible bettors have been refunded.`);

    console.log("\nTo use this match in other commands:");
    console.log(`npm run close-match -- --matchaccount ${matchAccount.toString()} --matchid ${argv.matchid}`);
    
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 