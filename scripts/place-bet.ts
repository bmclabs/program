import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
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
  .option('fighter', {
    alias: 'f',
    description: 'Fighter to bet on',
    type: 'string',
    default: 'DOGE'
  })
  .option('amount', {
    alias: 'amt',
    description: 'Bet amount in SOL',
    type: 'number',
    default: 0.1
  })
  .option('keypair', {
    alias: 'k',
    description: 'Path to keypair file',
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
  let walletPath = path.join(os.homedir(), '.config', 'solana', 'authority-test.json');
  
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
  
  // Validate inputs
  if (argv.amount <= 0) {
    console.error('Error: Bet amount must be greater than 0');
    process.exit(1);
  }
  
  if (!argv.fighter || argv.fighter.trim() === '') {
    console.error('Error: Fighter name cannot be empty');
    process.exit(1);
  }
  
  // Check wallet balance
  const walletBalance = await provider.connection.getBalance(provider.wallet.publicKey);
  const requiredBalance = argv.amount * LAMPORTS_PER_SOL;
  
  if (walletBalance < requiredBalance) {
    console.error(`Error: Insufficient SOL balance. You have ${walletBalance / LAMPORTS_PER_SOL} SOL but need ${argv.amount} SOL`);
    console.log(`To add more SOL: solana airdrop 1 $(solana address -k ${walletPath})`);
    process.exit(1);
  }
  
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
        console.error("Error: Program is currently paused. Cannot place bets.");
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
    
    // Verify the fighter is valid
    const validFighters = [];
    validFighters.push(matchData.fighter1);
    
    // Fighter 2 might be empty if this is the first bet
    if (matchData.fighter2 && matchData.fighter2.trim() !== '') {
      validFighters.push(matchData.fighter2);
    }
    
    // Check if fighter 2 is empty but the bet is not for fighter 1
    if (matchData.fighter2 === '' && argv.fighter !== matchData.fighter1) {
      // This will be the second fighter
      console.log(`Setting ${argv.fighter} as the second fighter.`);
    } else if (!validFighters.includes(argv.fighter)) {
      console.error(`Error: Invalid fighter "${argv.fighter}". Valid options are: ${validFighters.join(', ')}`);
      console.log(`Tip: Use --fighter ${validFighters[0]}${validFighters.length > 1 ? ` or --fighter ${validFighters[1]}` : ''}`);
      process.exit(1);
    }
    
    // Check if match is in correct state
    const currentStatus = Object.keys(matchData.status)[0];
    if (currentStatus !== 'initialized' && currentStatus !== 'preparation') {
      console.error(`Error: Cannot place bet. Match is in '${currentStatus}' state, but must be in 'Initialized' or 'Preparation' state.`);
      process.exit(1);
    }
    
    // Calculate bet amount in lamports
    const amount = new anchor.BN(argv.amount * LAMPORTS_PER_SOL);
    
    console.log(`Match data:`);
    console.log(`- Match ID: ${matchData.matchId}`);
    console.log(`- Fighter 1: ${matchData.fighter1}`);
    console.log(`- Fighter 2: ${matchData.fighter2}`);
    console.log(`- Status: ${currentStatus}`);
    console.log(`\nPlacing bet of ${argv.amount} SOL on ${argv.fighter} for match ${argv.matchid}`);
    
    // Place bet
    const tx = await program.methods
      .placeBet(argv.matchid, argv.fighter, amount)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        bettor: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log(`Successfully placed bet of ${argv.amount} SOL on ${argv.fighter}!`);
    
    console.log("\nNext steps:");
    console.log(`Update match status when ready: npm run update-status -- --matchaccount ${matchAccount.toString()} --status Battle`);
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("InvalidFighter")) {
      console.error("Invalid fighter. Make sure the fighter name is one of the fighters in this match.");
    } else if (error.toString().includes("InvalidMatchId")) {
      console.error("Invalid match ID. Make sure the match ID matches what was used when creating the match.");
    } else if (error.toString().includes("MatchNotInitialized")) {
      console.error("Match is not in 'Initialized' state. You can only place bets on matches in the Initialized state.");
    } else if (error.toString().includes("ProgramPaused")) {
      console.error("The program is currently paused. Cannot place bets until it's unpaused.");
      console.log("To unpause: npm run set-pause-state -- --paused false");
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
