import express from 'express';
import { ethers } from 'ethers';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import User from '../models/User.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Multi-network Configuration
const NETWORKS = {
  'base-sepolia': {
    name: 'Base Sepolia',
    rpc: process.env.BASE_RPC_URL || "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org"
  },
  'eth-sepolia': {
    name: 'Ethereum Sepolia',
    rpc: process.env.ETH_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io"
  }
};

const getProvider = (networkId: string) => {
  const config = NETWORKS[networkId as keyof typeof NETWORKS];
  if (!config) throw new Error(`Network ${networkId} not supported`);
  return new ethers.JsonRpcProvider(config.rpc);
};

/**
 * @route GET /api/wallets
 * @desc Initialize or fetch user wallets across multiple networks
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let wallet: ethers.Wallet;

    // Check if user already has an encrypted key
    if (user.encryptedPrivateKey) {
      const privateKey = decrypt(user.encryptedPrivateKey);
      wallet = new ethers.Wallet(privateKey);
    } else {
      // Create a brand new wallet
      wallet = ethers.Wallet.createRandom();
      
      // Encrypt and save the private key
      user.encryptedPrivateKey = encrypt(wallet.privateKey);
      
      // Initialize addresses for all supported networks (it's the same address for all EVM)
      user.walletAddresses.set('base-sepolia', wallet.address);
      user.walletAddresses.set('eth-sepolia', wallet.address);
      
      await user.save();
    }

    // Fetch balances for all active networks
    const balances = await Promise.all(
      Object.entries(NETWORKS).map(async ([id, config]) => {
        try {
          const provider = getProvider(id);
          const balanceWei = await provider.getBalance(wallet.address);
          return {
            amount: ethers.formatEther(balanceWei),
            assetId: 'eth',
            symbol: 'ETH',
            network: id,
            networkName: config.name,
            explorer: config.explorer
          };
        } catch (err) {
          console.error(`Balance fetch failed for ${id}:`, err);
          return null;
        }
      })
    );

    res.json({
      addresses: Object.fromEntries(user.walletAddresses),
      balances: balances.filter(b => b !== null),
    });

  } catch (error: any) {
    console.error('Wallet error:', error);
    res.status(500).json({ message: error.message || 'Failed to manage wallet' });
  }
});

/**
 * @route POST /api/wallets/send
 * @desc Send assets on-chain using Ethers.js
 */
router.post('/send', authMiddleware, async (req: AuthRequest, res) => {
  const { address, amount, assetId, network = 'base-sepolia' } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.encryptedPrivateKey) {
      return res.status(400).json({ message: 'Wallet not initialized' });
    }

    // Get provider for the specific network
    const provider = getProvider(network);

    // Decrypt key temporarily
    const privateKey = decrypt(user.encryptedPrivateKey);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Prepare transaction
    const tx = {
      to: address,
      value: ethers.parseEther(amount.toString())
    };

    // Send the transaction
    const response = await wallet.sendTransaction(tx);
    
    res.json({
      message: 'Transaction broadcasted',
      transactionHash: response.hash,
      status: 'pending',
      network: network
    });

  } catch (error: any) {
    console.error('Transfer error:', error);
    res.status(500).json({ message: error.message || 'Transfer failed' });
  }
});

export default router;
