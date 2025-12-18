// ===============================================================================
// APEX UNIFIED MASTER v12.5.0 (QUICKNODE BUNDLER + MULTI-STRAT API)
// ===============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// 1. CONFIGURATION
const PORT = process.env.PORT || 8080;
const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const CONTRACT_ADDR = "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0";
const PAYOUT_WALLET = process.env.PAYOUT_WALLET;

// Specialized Tokens (Base "Long Tail" targets)
const TOKENS = {
    WETH: "0x4200000000000000000000000000000000000006",
    DEGEN: "0x4edbc9ba171790664872997239bc7a3f3a633190",
    VIRTUAL: "0x0b3e328455822223971382430b04e370d2367831" 
};

const ABI = [
    "function executeFlashArbitrage(address tokenA, address tokenOut, uint256 amount) external",
    "function getContractBalance() external view returns (uint256)",
    "function withdraw() external"
];

let provider, signer, flashContract, transactionNonce;
let totalEarnings = 0;
let lastLogTime = Date.now();

// 2. HARDENED BOOT
async function init() {
    const baseNetwork = ethers.Network.from(8453);
    provider = new ethers.JsonRpcProvider(process.env.QUICKNODE_HTTP, baseNetwork, { staticNetwork: baseNetwork });
    signer = new ethers.Wallet(PRIVATE_KEY, provider);
    flashContract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
    
    transactionNonce = await provider.getTransactionCount(signer.address, 'latest');
    console.log(`[BOOT] Apex Engine Live. Nonce: ${transactionNonce} | Target: Long-Tail`);
}

// 3. APEX EXECUTION (The "First" Logic)
async function executeApexStrike(targetTx) {
    try {
        if (!targetTx || !targetTx.to) return;
        
        // Filter for significant DEX swaps (>0.05 ETH)
        if (targetTx.value > ethers.parseEther("0.05")) {
            lastLogTime = Date.now();
            console.log(`[🎯 TARGET] Whale: ${ethers.formatEther(targetTx.value)} ETH. Simulating...`);

            // --- SIMULATION (Free Shield) ---
            try {
                await flashContract.executeFlashArbitrage.staticCall(TOKENS.WETH, TOKENS.DEGEN, ethers.parseEther("100"));
            } catch (err) { return; } // Failed sim = No profit. Skip.

            // --- AGGRESSIVE BUNDLE ---
            const feeData = await provider.getFeeData();
            const aggressiveBribe = (feeData.maxPriorityFeePerGas * 2n);

            const strike = await flashContract.executeFlashArbitrage(
                TOKENS.WETH,
                TOKENS.DEGEN,
                ethers.parseEther("100"), 
                {
                    gasLimit: 850000,
                    maxPriorityFeePerGas: aggressiveBribe, // Jump the queue
                    maxFeePerGas: feeData.maxFeePerGas,
                    nonce: transactionNonce++,
                    type: 2
                }
            );

            console.log(`[🚀 STRIKE SENT] Tx: ${strike.hash}`);
            const receipt = await strike.wait(1);
            if (receipt.status === 1) {
                totalEarnings += 12.50; // Estimated profit logging
                console.log(`[💰 SUCCESS] Profit Captured!`);
            }
        }
    } catch (e) {
        if (e.message.includes("nonce")) transactionNonce = await provider.getTransactionCount(signer.address, 'latest');
    }
}

// 4. THE DARK FOREST SCANNER (WSS)
function startScanning() {
    const wssProvider = new ethers.WebSocketProvider(process.env.QUICKNODE_WSS);
    
    wssProvider.on("pending", async (txHash) => {
        const tx = await provider.getTransaction(txHash);
        if (tx) executeApexStrike(tx);
    });

    setInterval(() => {
        const idle = (Date.now() - lastLogTime) / 1000;
        console.log(`[SCAN] Active. Idle: ${idle.toFixed(0)}s | Nonce: ${transactionNonce}`);
    }, 60000);
}

// 5. API ENDPOINTS (Unified Management)
app.get('/status', async (req, res) => {
    try {
        const bal = await provider.getBalance(signer.address);
        const contractBal = await flashContract.getContractBalance();
        res.json({
            status: "HUNTING",
            wallet_eth: ethers.formatEther(bal),
            contract_weth: ethers.formatEther(contractBal),
            estimated_earnings_usd: totalEarnings
        });
    } catch (e) { res.json({ status: "ERROR" }); }
});

app.post('/withdraw', async (req, res) => {
    try {
        const tx = await flashContract.withdraw({ nonce: transactionNonce++ });
        await tx.wait();
        res.json({ success: true, hash: tx.hash });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 6. START
init().then(() => {
    app.listen(PORT, () => {
        console.log(`[SYSTEM] v12.5.0 API listening on ${PORT}`);
        startScanning();
    });
});
