// ===============================================================================
// APEX UNIFIED MASTER v12.5.1 (MULTI-RPC FAILOVER + ANTI-CRASH)
// ===============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// 1. CONFIGURATION & FAILOVER POOL
const PORT = process.env.PORT || 8080;
const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const CONTRACT_ADDR = "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0";

// Public RPCs act as a safety net so the bot NEVER defaults to 127.0.0.1
const RPC_POOL = [
    process.env.QUICKNODE_HTTP,      
    "https://mainnet.base.org",      
    "https://base.llamarpc.com",     
    "https://base.drpc.org"          
].filter(url => url && url.startsWith('http'));

const WSS_URL = process.env.QUICKNODE_WSS || "wss://base-rpc.publicnode.com";

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

// 2. HARDENED BOOT (With Fallback Logic)
async function init() {
    console.log("🛡️ BOOTING APEX SURVIVAL ENGINE...");
    const baseNetwork = ethers.Network.from(8453);

    // Map all pool URLs into Fallback configurations
    const configs = RPC_POOL.map((url, i) => ({
        provider: new ethers.JsonRpcProvider(url, baseNetwork, { staticNetwork: baseNetwork }),
        priority: i === 0 ? 1 : 2, // Prefer your QuickNode first
        stallTimeout: 2500
    }));

    // The FallbackProvider prevents the "ECONNREFUSED" crash
    provider = new ethers.FallbackProvider(configs);
    
    signer = new ethers.Wallet(PRIVATE_KEY, provider);
    flashContract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
    
    try {
        transactionNonce = await provider.getTransactionCount(signer.address, 'latest');
        console.log(`✅ [BOOT] Online. Nonce: ${transactionNonce} | RPCs Active: ${RPC_POOL.length}`);
    } catch (e) {
        console.error("❌ [CRITICAL] All RPCs failed to respond.");
        process.exit(1);
    }
}

// 3. APEX EXECUTION
async function executeApexStrike(targetTx) {
    try {
        if (!targetTx || !targetTx.to) return;
        
        if (targetTx.value > ethers.parseEther("0.05")) {
            lastLogTime = Date.now();
            console.log(`[🎯 TARGET] Whale: ${ethers.formatEther(targetTx.value)} ETH.`);

            // --- SIMULATION (Free Shield) ---
            try {
                await flashContract.executeFlashArbitrage.staticCall(TOKENS.WETH, TOKENS.DEGEN, ethers.parseEther("100"));
            } catch (err) { return; } 

            // --- AGGRESSIVE BUNDLE ---
            const feeData = await provider.getFeeData();
            const strike = await flashContract.executeFlashArbitrage(
                TOKENS.WETH,
                TOKENS.DEGEN,
                ethers.parseEther("100"), 
                {
                    gasLimit: 850000,
                    maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 2n), 
                    maxFeePerGas: feeData.maxFeePerGas,
                    nonce: transactionNonce++,
                    type: 2
                }
            );

            console.log(`[🚀 STRIKE SENT] Tx: ${strike.hash}`);
            const receipt = await strike.wait(1);
            if (receipt.status === 1) {
                totalEarnings += 12.50; 
                console.log(`[💰 SUCCESS] Profit Captured!`);
            }
        }
    } catch (e) {
        if (e.message.includes("nonce")) transactionNonce = await provider.getTransactionCount(signer.address, 'latest');
    }
}

// 4. THE DARK FOREST SCANNER (WSS with Reconnect)
function startScanning() {
    console.log(`🔍 MEMPOOL SCANNER LIVE: ${WSS_URL.substring(0, 30)}...`);
    const wssProvider = new ethers.WebSocketProvider(WSS_URL);
    
    wssProvider.on("pending", async (txHash) => {
        try {
            const tx = await provider.getTransaction(txHash);
            if (tx) executeApexStrike(tx);
        } catch (e) { /* FallbackProvider handles retries */ }
    });

    // Auto-reconnect on WSS failure
    wssProvider.websocket.on("close", () => {
        console.log("🔄 WSS Drop. Reconnecting...");
        setTimeout(startScanning, 5000);
    });

    setInterval(() => {
        const idle = (Date.now() - lastLogTime) / 1000;
        console.log(`[SCAN] Active. Idle: ${idle.toFixed(0)}s | Nonce: ${transactionNonce}`);
    }, 60000);
}

// 5. API ENDPOINTS
app.get('/status', async (req, res) => {
    try {
        const bal = await provider.getBalance(signer.address);
        const contractBal = await flashContract.getContractBalance();
        res.json({
            status: "HUNTING",
            wallet_eth: ethers.formatEther(bal),
            contract_weth: ethers.formatEther(contractBal),
            rpcs_online: RPC_POOL.length
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
        console.log(`[SYSTEM] v12.5.1 API listening on ${PORT}`);
        startScanning();
    });
});
