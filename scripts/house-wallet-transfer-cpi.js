#!/usr/bin/env node
const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const anchor = require('@coral-xyz/anchor');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('recipient', {
    alias: 'r',
    description: 'Recipient wallet public key',
    type: 'string',
    demandOption: true
  })
  .option('amount', {
    alias: 'm',
    description: 'Amount to transfer in SOL',
    type: 'number',
    demandOption: true
  })
  .option('keypair', {
    alias: 'k',
    description: 'Path to authority keypair file',
    type: 'string'
  })
  .option('programid', {
    alias: 'p',
    description: 'Program ID (default: 3dBYh1pjekocsJQGXM3y1MW6bjVrvvnCXpVEZTffGvmC)',
    type: 'string',
    default: '3dBYh1pjekocsJQGXM3y1MW6bjVrvvnCXpVEZTffGvmC'
  })
  .option('url', {
    alias: 'u',
    description: 'RPC URL for Solana connection',
    type: 'string',
    default: 'https://api.devnet.solana.com'
  })
  .help()
  .alias('help', 'h')
  .parse();

async function main() {
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
  
  // Load the keypair
  const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')));
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(secretKey));
  
  // Create connection and provider
  const connection = new Connection(argv.url, 'confirmed');
  const provider = new anchor.AnchorProvider(
    connection,
    wallet,
    { commitment: 'confirmed' }
  );
  anchor.setProvider(provider);
  
  try {
    // Parse recipient pubkey
    let recipient;
    try {
      recipient = new PublicKey(argv.recipient);
    } catch (e) {
      console.error(`Error: Invalid recipient public key format: ${argv.recipient}`);
      process.exit(1);
    }
    
    // Use the program ID from command line arguments or default
    const programId = new PublicKey(argv.programid);
    
    // Find PDA for house wallet
    const [houseWallet, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("house")],
      programId
    );
    
    console.log(`Found house wallet PDA: ${houseWallet.toString()}`);
    
    // Get current balance of the house wallet
    const houseBalance = await connection.getBalance(houseWallet);
    console.log(`House wallet balance: ${houseBalance / 1_000_000_000} SOL`);
    
    // Convert SOL to lamports
    const amountLamports = Math.floor(1_000_000_000 * argv.amount);
    
    if (houseBalance < amountLamports) {
      console.error(`Error: House wallet doesn't have enough balance. Required: ${amountLamports / 1_000_000_000} SOL, Available: ${houseBalance / 1_000_000_000} SOL`);
      process.exit(1);
    }
    
    console.log(`Manual transfer from house wallet:`);
    console.log(`- From House Wallet: ${houseWallet.toString()}`);
    console.log(`- To Recipient: ${recipient.toString()}`);
    console.log(`- Amount: ${argv.amount} SOL (${amountLamports} lamports)`);
    
    // Load the program IDL
    let idl;
    try {
      idl = JSON.parse(fs.readFileSync('./target/idl/battle_memecoin_club.json', 'utf8'));
    } catch (error) {
      console.error("Failed to load IDL file. Make sure the program is built and the IDL is generated");
      console.error("Run 'anchor build' first to generate the IDL");
      process.exit(1);
    }
    
    // Initialize program
    const program = new anchor.Program(idl, programId);
    
    console.log("Sending transfer transaction...");
    try {
      // Call the transfer_from_house_wallet instruction using Anchor
      const transaction = await program.methods
        .transferFromHouseWallet(new anchor.BN(amountLamports))
        .accounts({
          houseWallet: houseWallet,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
          recipient: recipient
        })
        .transaction();
      
      const txSignature = await anchor.web3.sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet.payer]
      );
      
      console.log(`Transfer transaction signature: ${txSignature}`);
      console.log(`Success: ${argv.amount} SOL transferred from house wallet PDA to ${recipient.toString()}`);
      
      // Get updated balance
      const newHouseBalance = await connection.getBalance(houseWallet);
      console.log(`- Updated house wallet balance: ${newHouseBalance / 1_000_000_000} SOL`);
      console.log(`- Amount transferred: ${(houseBalance - newHouseBalance) / 1_000_000_000} SOL`);
    } catch (error) {
      console.error("Error sending transaction:", error);
      process.exit(1);
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