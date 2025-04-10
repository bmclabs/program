import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Commitment, Keypair } from "@solana/web3.js";
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
  .option('paused', {
    alias: 'p',
    description: 'Set program to paused state',
    type: 'boolean',
    default: true
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
  
  try {
    // Configure connection with better retry and preflight settings
    const commitment: Commitment = "confirmed";
    const connection = new Connection(process.env.ANCHOR_PROVIDER_URL, {
      commitment,
      confirmTransactionInitialTimeout: 60000, // 60 seconds
      disableRetryOnRateLimit: false,
    });
    
    // Read and load keypair from the wallet file
    const secretKey = Buffer.from(JSON.parse(fs.readFileSync(defaultWalletPath, 'utf-8')));
    const keypair = Keypair.fromSecretKey(secretKey);
    const wallet = new anchor.Wallet(keypair);

    const provider = new anchor.AnchorProvider(
      connection, 
      wallet, 
      { commitment, preflightCommitment: commitment, skipPreflight: false }
    );
    
    anchor.setProvider(provider);
    
    // Get program ID from environment variable or IDL 
    const programId = new PublicKey(process.env.PROGRAM_ID || idl.address);
    
    // Create program instance
    const program = new Program(idl as any, provider);
    
    // Find PDA for house wallet
    const [houseWallet] = await PublicKey.findProgramAddress(
      [Buffer.from("house")],
      program.programId
    );
    
    console.log(`Setting program to ${argv.paused ? 'paused' : 'unpaused'} state...`);
    console.log(`Authority: ${provider.wallet.publicKey.toString()}`);
    console.log(`House wallet: ${houseWallet.toString()}`);
    
    // Update pause state
    try {
      // Get a fresh blockhash before sending transaction
      const latestBlockhash = await connection.getLatestBlockhash();
      
      const tx = await program.methods
        .setPauseState(argv.paused)
        .accounts({
          houseWallet: houseWallet,
          authority: provider.wallet.publicKey,
        })
        .rpc({ skipPreflight: false, maxRetries: 5 });
      
      console.log("Transaction signature:", tx);
      
      // Confirm transaction
      const confirmation = await connection.confirmTransaction({
        signature: tx,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, commitment);
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log(`Program is now ${argv.paused ? 'paused' : 'unpaused'}.`);
      if (argv.paused) {
        console.log("When program is paused, users cannot place bets or create new matches.");
        console.log("To unpause, run: npm run set-pause-state -- --paused false");
      } else {
        console.log("Program is now active and accepting bets/matches.");
      }
    } catch (error) {
      console.error("Error setting pause state:", error);
      
      // Provide more helpful error messages based on common error cases
      if (error.toString().includes("Unauthorized")) {
        console.error("You are not authorized to change the program state. Only the program authority can do this.");
      } else if (error.toString().includes("Blockhash not found")) {
        console.error("Connection to Solana network is unstable. Try using a different RPC endpoint in your .env file.");
        console.error("Current RPC: ", process.env.ANCHOR_PROVIDER_URL);
        console.error("Alternative RPCs: https://rpc.ankr.com/solana, https://solana-mainnet.rpc.extrnode.com");
      }
      
      process.exit(1);
    }
  } catch (err) {
    console.error("Error loading wallet or setting up connection:", err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 