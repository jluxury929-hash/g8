// ===============================================================================
// APEX UNIFIED MASTER v12.5.5 (FAILOVER + LIVE BALANCE + FLASH STRIKE)
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
    DEGEN: "0x4edbc9ba171790664872997239bc7a3f3a633190"
};

const ABI = [
    "function executeFlashArbitrage(address tokenA, address tokenOut, uint256 amount) external",
    "function getContractBalance() external view returns (uint256)",
    "function withdraw() external"
];

let provider, signer, flashContract, transactionNonce;
let lastLogTime = Date.now();

// 2. HARDENED BOOT (With Fallback + Immediate Balance Audit)
async function init() {
    console.log("-----------------------------------------");
    console.log("🛡️ BOOTING APEX UNIFIED v12.5.5...");
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
        const walletBal = await provider.getBalance(signer.address);
        const contractBal = await flashContract.getContractBalance();
        transactionNonce = await provider.getTransactionCount(signer.address, 'pending');

        console.log(`✅ [BOOT] Online.`);
        console.log(`[WALLET] Base ETH: ${ethers.formatEther(walletBal)} ETH`);
        console.log(`[CONTRACT] WETH:  ${ethers.formatEther(contractBal)} WETH`);
        console.log(`[NONCE]  Next ID: ${transactionNonce}`);
        console.log(`📡 POOL: ${RPC_POOL.length} RPCs Active.`);
        console.log("-----------------------------------------");
    } catch (e) {
        console.error("❌ [CRITICAL] All RPCs failed to respond.");
        process.exit(1);
    }
}

// 3. APEX EXECUTION (Flash Strike Logic)
async function executeApexStrike(targetTx) {
    try {
        if (!targetTx || !targetTx.to || targetTx.value < ethers.parseEther("0.05")) return;
        
        const balance = await provider.getBalance(signer.address);
        if (balance < ethers.parseEther("0.0015")) return; 

        lastLogTime = Date.now();
        console.log(`[🎯 TARGET] Whale: ${ethers.formatEther(targetTx.value)} ETH.`);

        // Simulation
        try {
            await flashContract.executeFlashArbitrage.staticCall(TOKENS.WETH, TOKENS.DEGEN, ethers.parseEther("100"));
        } catch (err) { return; } 

        const feeData = await provider.getFeeData();
        const strike = await flashContract.executeFlashArbitrage(
            TOKENS.WETH,
            TOKENS.DEGEN,
            ethers.parseEther("100"), 
            {
                gasLimit: 850000,
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

// 4. SCANNER & HEARTBEAT MONITORING
function startScanning() {
    console.log(`🔍 SCANNER LIVE: ${WSS_URL.substring(0, 30)}...`);
    const wssProvider = new ethers.WebSocketProvider(WSS_URL);
    
    wssProvider.on("pending", async (txHash) => {
        try {
            const tx = await provider.getTransaction(txHash);
            if (tx) executeApexStrike(tx);
        } catch (e) { }
    });

    // PING-PONG Heartbeat
    const heartbeatPing = setInterval(() => {
        if (wssProvider.websocket.readyState === 1) wssProvider.websocket.ping();
    }, 30000);

    // --- RECURRING LOG HEARTBEAT (Every 60s) ---
    setInterval(async () => {
        try {
            const bal = await provider.getBalance(signer.address);
            const idle = (Date.now() - lastLogTime) / 1000;
            console.log(`[SYNC] Wallet: ${ethers.formatEther(bal)} ETH | Idle: ${idle.toFixed(0)}s | Nonce: ${transactionNonce}`);
        } catch (e) {
            console.log(`[SYNC] RPC Lag - Waiting for next heartbeat...`);
        }
    }, 60000);

    wssProvider.websocket.on("close", () => {
        clearInterval(heartbeatPing);
        console.log("🔄 WSS Drop. Reconnecting...");
        setTimeout(startScanning, 5000);
    });
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
            rpcs: RPC_POOL.length,
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
        console.log(`[SYSTEM] v12.5.5 API online on Port ${PORT}`);
        startScanning();
    });
});
