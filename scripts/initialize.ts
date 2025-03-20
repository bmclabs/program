import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import idl from "../target/idl/battle_memecoin.json";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  // ensure environment variables are set
  if (!process.env.ANCHOR_PROVIDER_URL) {
    process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";
  }
  
  // Set up wallet path
  const defaultWalletPath = path.join(os.homedir(), '.config', 'solana', 'test-authority.json');
  
  // Check if wallet file exists, if not create one
  if (!fs.existsSync(defaultWalletPath)) {
    console.log(`Wallet file not found at ${defaultWalletPath}. Creating new wallet...`);
    
    // Create .config/solana directory if it doesn't exist
    const solanaConfigDir = path.join(os.homedir(), '.config', 'solana');
    if (!fs.existsSync(solanaConfigDir)) {
      fs.mkdirSync(solanaConfigDir, { recursive: true });
    }
    
    // Generate new keypair
    const newWallet = Keypair.generate();
    
    // Save to file
    fs.writeFileSync(
      defaultWalletPath,
      JSON.stringify(Array.from(newWallet.secretKey)),
      { mode: 0o600 }
    );
    
    console.log(`New wallet created and saved to ${defaultWalletPath}`);
  }
  
  // Use the wallet path we just verified/created
  process.env.ANCHOR_WALLET = defaultWalletPath;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as any, provider);
  
  // Find PDA for house wallet
  const [houseWallet, bump] = await PublicKey.findProgramAddress(
    [Buffer.from("house")],
    program.programId
  );
  
  console.log("House wallet PDA:", houseWallet.toString());
  
  // Initialize house wallet
  const tx = await program.methods
    .initialize(bump)
    .accounts({
      houseWallet: houseWallet,
      authority: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  
  console.log("Initialization transaction signature:", tx);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
