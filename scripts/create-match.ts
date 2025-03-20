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
  .option('matchid', {
    alias: 'm',
    description: 'Match ID',
    type: 'string',
    default: 'MATCH_001'
  })
  .option('fighter1', {
    alias: 'f1',
    description: 'First fighter name',
    type: 'string',
    default: 'DOGE'
  })
  .option('fighter2', {
    alias: 'f2',
    description: 'Second fighter name',
    type: 'string',
    default: 'SHIB'
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
  
  // Validate inputs
  if (argv.fighter1 === argv.fighter2) {
    console.error(`Error: Fighter 1 and Fighter 2 cannot be the same "${argv.fighter1}"`);
    process.exit(1);
  }
  
  if (!argv.matchid || argv.matchid.trim() === '') {
    console.error('Error: Match ID cannot be empty');
    process.exit(1);
  }
  
  if (!argv.fighter1 || argv.fighter1.trim() === '') {
    console.error('Error: Fighter 1 name cannot be empty');
    process.exit(1);
  }
  
  if (!argv.fighter2 || argv.fighter2.trim() === '') {
    console.error('Error: Fighter 2 name cannot be empty');
    process.exit(1);
  }
  
  // Check for program pause state
  try {
    // Find PDA for house wallet
    const [houseWallet] = await PublicKey.findProgramAddress(
      [Buffer.from("house")],
      program.programId
    );
    
    const houseInfo = await provider.connection.getAccountInfo(houseWallet);
    if (houseInfo) {
      const houseData = program.coder.accounts.decode('houseWallet', houseInfo.data);
      if (houseData.paused) {
        console.error("Error: Program is currently paused. New matches cannot be created.");
        console.log("To unpause: npm run set-pause-state -- --paused false");
        process.exit(1);
      }
    }
    
    // Generate a new keypair for the match account
    const matchAccount = anchor.web3.Keypair.generate();
    console.log(`Creating match:`);
    console.log(`- Match ID: ${argv.matchid}`);
    console.log(`- Fighter 1: ${argv.fighter1}`);
    console.log(`- Fighter 2: ${argv.fighter2}`);
    console.log("Match account:", matchAccount.publicKey.toString());
    
    // Create match account
    const tx = await program.methods
      .createMatchAccount(argv.matchid, argv.fighter1, argv.fighter2)
      .accounts({
        matchAccount: matchAccount.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([matchAccount])
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log(`\nMatch created successfully!`);
    
    console.log("\nTo use this match in other commands:");
    console.log(`npm run place-bet -- --matchaccount ${matchAccount.publicKey.toString()} --matchid ${argv.matchid} --fighter ${argv.fighter1}`);
    console.log(`npm run update-status -- --matchaccount ${matchAccount.publicKey.toString()}`);
    console.log(`npm run end-match -- --matchaccount ${matchAccount.publicKey.toString()} --matchid ${argv.matchid} --winner ${argv.fighter1}`);
    console.log(`npm run claim-prize -- --matchaccount ${matchAccount.publicKey.toString()} --matchid ${argv.matchid}`);
    console.log(`npm run claim-refund -- --matchaccount ${matchAccount.publicKey.toString()} --matchid ${argv.matchid}`);
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("ProgramPaused")) {
      console.error("Program is currently paused. New matches cannot be created.");
      console.log("To unpause: npm run set-pause-state -- --paused false");
    } else if (error.toString().includes("DuplicateMatch")) {
      console.error(`A match with ID "${argv.matchid}" already exists. Please choose a different match ID.`);
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
