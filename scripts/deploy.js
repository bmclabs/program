#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Set the paths
const programName = 'program';
const programPath = path.join(__dirname, '..', 'target', 'deploy', `${programName}.so`);
const programKeypairPath = path.join(__dirname, '..', 'target', 'deploy', `${programName}-keypair.json`);
const walletPath = path.join(os.homedir(), '.config', 'solana', 'authority-test.json');

// Verify files exist
if (!fs.existsSync(programPath)) {
  console.error(`Program binary not found at ${programPath}`);
  console.error('Run "anchor build" first');
  process.exit(1);
}

if (!fs.existsSync(programKeypairPath)) {
  console.error(`Program keypair not found at ${programKeypairPath}`);
  process.exit(1);
}

if (!fs.existsSync(walletPath)) {
  console.error(`Wallet not found at ${walletPath}`);
  process.exit(1);
}

try {
  console.log('Deploying program to devnet...');
  
  // Try deploying directly with increased program space
  console.log('Deploying with increased program space...');
  
  const deployOutput = execSync(
    `solana program deploy ${programPath} --program-id ${programKeypairPath} --keypair ${walletPath} --url devnet`,
    { encoding: 'utf-8' }
  );
  
  console.log(deployOutput);
  console.log('Program deployed successfully!');
  
} catch (error) {
  console.error('Deployment failed:');
  console.error(error.toString());
  
  // Try to provide more helpful error message
  if (error.stdout) {
    console.error('Command output:', error.stdout.toString());
  }
  
  if (error.stderr) {
    console.error('Command error output:', error.stderr.toString());
  }
  
  process.exit(1);
} 