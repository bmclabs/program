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
  .help()
  .alias('help', 'h')
  .parse();

async function main() {
  // ensure environment variables are set
  if (!process.env.ANCHOR_PROVIDER_URL) {
    process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";
  }
  
  // Set up wallet path
  const walletPath = path.join(os.homedir(), '.config', 'solana', 'authority-test.json');

  // Set wallet path
  process.env.ANCHOR_WALLET = walletPath;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as any, provider);
  
  try {
    // Use match account from command line args
    const matchAccount = new PublicKey(argv.matchaccount);
    
    // Fetch match data
    const accountInfo = await provider.connection.getAccountInfo(matchAccount);
    if (!accountInfo) {
      console.error(`Error: Match account not found at ${matchAccount.toString()}`);
      process.exit(1);
    }
    
    // Decode the account data
    const matchData = program.coder.accounts.decode('matchAccount', accountInfo.data);
    
    // Display match data
    console.log("=== Match Information ===");
    console.log(`Match Account: ${matchAccount.toString()}`);
    console.log(`Match ID: ${matchData.matchId}`);
    console.log(`Fighter 1: ${matchData.fighter1}`);
    console.log(`Fighter 2: ${matchData.fighter2 || 'Not set'}`);
    console.log(`Status: ${Object.keys(matchData.status)[0]}`);
    console.log(`Winner: ${matchData.winner ? matchData.winner : 'Not set'}`);
    console.log(`Total bets on ${matchData.fighter1}: ${matchData.totalBetsFighter1.toString()} lamports`);
    console.log(`Total bets on ${matchData.fighter2 || 'Fighter 2'}: ${matchData.totalBetsFighter2.toString()} lamports`);
    console.log(`Prize pool: ${matchData.prizePool.toString()} lamports`);
    
    // Display all bets
    console.log("\n=== Bets ===");
    if (matchData.bets.length === 0) {
      console.log("No bets placed yet");
    } else {
      matchData.bets.forEach((bet, index) => {
        console.log(`Bet #${index + 1}:`);
        console.log(`  Bettor: ${bet.bettor.toString()}`);
        console.log(`  Amount: ${bet.amount.toString()} lamports (${bet.amount.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL)`);
        console.log(`  Fighter: ${bet.fighter}`);
        console.log(`  Claimed: ${bet.claimed ? 'Yes' : 'No'}`);
      });
    }
    
    console.log("\n=== Next Steps ===");
    const status = Object.keys(matchData.status)[0];
    if (status === 'preparation') {
      console.log(`Update match status to Battle: npm run update-status -- --matchaccount ${matchAccount.toString()} --status Battle`);
    } else if (status === 'battle') {
      console.log(`End match: npm run end-match -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId} --winner ${matchData.fighter1}`);
      console.log(`OR: npm run end-match -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId} --winner ${matchData.fighter2 || 'Fighter2'}`);
    } else if (status === 'completed') {
      console.log(`Claim prize: npm run claim-prize -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId}`);
    } else if (status === 'refund') {
      console.log(`Claim refund: npm run claim-refund -- --matchaccount ${matchAccount.toString()} --matchid ${matchData.matchId}`);
    }
    
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 