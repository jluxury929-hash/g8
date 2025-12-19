// ===============================================================================
// APEX UNIFIED MASTER v12.5.3 (FAILOVER + WSS STABILIZED + PENDING NONCE)
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
let lastLogTime = Date.now();

// 2. HARDENED BOOT (With Fallback + Pending Nonce)
async function init() {
    console.log("🛡️ BOOTING APEX SURVIVAL ENGINE...");
    const baseNetwork = ethers.Network.from(8453);

    const configs = RPC_POOL.map((url, i) => ({
        provider: new ethers.JsonRpcProvider(url, baseNetwork, { staticNetwork: baseNetwork }),
        priority: i === 0 ? 1 : 2, 
        stallTimeout: 2500
    }));

    provider = new ethers.FallbackProvider(configs);
    signer = new ethers.Wallet(PRIVATE_KEY, provider);
    flashContract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
    
    try {
        // FIX: Use 'pending' tag to include transactions currently in mempool
        transactionNonce = await provider.getTransactionCount(signer.address, 'pending');
        console.log(`✅ [BOOT] Online. Nonce: ${transactionNonce} | RPCs Active: ${RPC_POOL.length}`);
    } catch (e) {
        console.error("❌ [CRITICAL] All RPCs failed to respond.");
        process.exit(1);
    }
}

// 3. APEX EXECUTION (With Gas Guard & Aggressive Bidding)
async function executeApexStrike(targetTx) {
    try {
        if (!targetTx || !targetTx.to || targetTx.value < ethers.parseEther("0.05")) return;
        
        // GAS GUARD: Don't attempt if wallet is too low to pay gas
        const balance = await provider.getBalance(signer.address);
        if (balance < ethers.parseEther("0.0015")) return; 

        lastLogTime = Date.now();
        console.log(`[🎯 TARGET] Whale: ${ethers.formatEther(targetTx.value)} ETH.`);

        // --- SIMULATION ---
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
                // FIX: 3x Priority to win block space
                maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 3n), 
                maxFeePerGas: (feeData.maxFeePerGas * 2n),
                nonce: transactionNonce++,
                type: 2
            }
        );

        console.log(`[🚀 STRIKE SENT] Tx: ${strike.hash}`);
        const receipt = await strike.wait(1);
        if (receipt.status === 1) console.log(`[💰 SUCCESS] Profit Captured!`);

    } catch (e) {
        if (e.message.includes("nonce") || e.message.includes("replacement")) {
            transactionNonce = await provider.getTransactionCount(signer.address, 'pending');
        }
    }
}

// 4. THE DARK FOREST SCANNER (WSS with Heartbeat)
function startScanning() {
    console.log(`🔍 SCANNER LIVE: ${WSS_URL.substring(0, 30)}...`);
    const wssProvider = new ethers.WebSocketProvider(WSS_URL);
    
    wssProvider.on("pending", async (txHash) => {
        try {
            const tx = await provider.getTransaction(txHash);
            if (tx) executeApexStrike(tx);
        } catch (e) { }
    });

    // FIX: Ping-Pong Heartbeat to prevent silent drops on public nodes
    const heartbeat = setInterval(() => {
        if (wssProvider.websocket.readyState === 1) { // 1 = OPEN
            wssProvider.websocket.ping();
        }
    }, 30000);

    wssProvider.websocket.on("close", () => {
        clearInterval(heartbeat);
        console.log("🔄 WSS Drop. Reconnecting...");
        setTimeout(startScanning, 5000);
    });

    // Logging Interval
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
            rpcs_online: RPC_POOL.length,
            nonce: transactionNonce
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
        console.log(`[SYSTEM] v12.5.3 API listening on ${PORT}`);
        startScanning();
    });
});
