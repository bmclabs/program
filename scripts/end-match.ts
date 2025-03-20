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
  .option('matchid', {
    alias: 'm',
    description: 'Match ID',
    type: 'string',
    default: 'MATCH_001'
  })
  .option('winner', {
    alias: 'w',
    description: 'Winner fighter name',
    type: 'string',
    default: 'DOGE'
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
  
  // Use match account from command line args
  const matchAccount = new PublicKey(argv.matchaccount);
  
  // Find PDA for house wallet
  const [houseWallet] = await PublicKey.findProgramAddress(
    [Buffer.from("house")],
    program.programId
  );
  
  // Get the match data to verify fighter values before ending match
  try {
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
    console.log(`- Status: ${Object.keys(matchData.status)[0]}`);
    
    // Check if match ID matches
    if (matchData.matchId !== argv.matchid) {
      console.error(`Error: Match ID mismatch. The match account has ID "${matchData.matchId}" but you specified "${argv.matchid}"`);
      process.exit(1);
    }
    
    // Verify the winner is one of the fighters
    const validWinners = [matchData.fighter1, matchData.fighter2];
    if (!validWinners.includes(argv.winner)) {
      console.error(`Error: Invalid winner "${argv.winner}". Valid options are: ${validWinners.join(', ')}`);
      console.log(`Tip: Use --winner ${validWinners[0]} or --winner ${validWinners[1]}`);
      process.exit(1);
    }
    
    // Check if match is in Battle status
    if (Object.keys(matchData.status)[0] !== 'battle') {
      console.error(`Error: Match is not in "Battle" state. Current state: ${Object.keys(matchData.status)[0]}`);
      console.log(`Tip: Update match status to Battle first:`);
      console.log(`npm run update-status -- --matchaccount ${matchAccount.toString()} --status Battle`);
      process.exit(1);
    }
    
    console.log(`Ending match ${argv.matchid} with winner ${argv.winner}`);
    
    // End match
    const tx = await program.methods
      .endMatch(argv.matchid, argv.winner)
      .accounts({
        matchAccount: matchAccount,
        houseWallet: houseWallet,
        treasury: provider.wallet.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log("Transaction signature:", tx);
    console.log(`Match ended successfully with ${argv.winner} as winner!`);
    console.log(`\nNext steps:`);
    console.log(`- To claim prizes: npm run claim-prize -- --matchaccount ${matchAccount.toString()} --matchid ${argv.matchid}`);
  } catch (error) {
    console.error("Error:", error);
    
    // Provide more helpful error messages based on common error cases
    if (error.toString().includes("InvalidWinner")) {
      console.error("Invalid winner. Make sure the winner is one of the fighters in this match.");
    } else if (error.toString().includes("InvalidMatchId")) {
      console.error("Invalid match ID. Make sure the match ID matches what was used when creating the match.");
    } else if (error.toString().includes("MatchNotBattle")) {
      console.error("Match must be in 'Battle' state before ending. Please update the status first.");
      console.log(`Run: npm run update-status -- --matchaccount ${matchAccount.toString()} --status Battle`);
    } else if (error.toString().includes("MatchNotInCorrectState")) {
      console.error("Match must be in 'Battle' state before ending. Current state may be 'Initialized' or 'Completed'.");
      console.log(`Run: npm run update-status -- --matchaccount ${matchAccount.toString()} --status Battle`);
    } else if (error.toString().includes("ProgramPaused")) {
      console.error("The program is currently paused. Unpause it using 'npm run set-pause-state -- --paused false'.");
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
