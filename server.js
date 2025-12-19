// ===============================================================================
// APEX UNIFIED MASTER v12.7.5 (NITRO-HYBRID: HIGH-SPEED + PROFIT MONITOR)
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
const PAYOUT_WALLET = process.env.PAYOUT_WALLET || "0xSET_YOUR_WALLET";

const RPC_POOL = [
    process.env.QUICKNODE_HTTP,
    "https://mainnet.base.org",
    "https://base.llamarpc.com"
].filter(url => url).map(u => u.trim().replace(/['"]+/g, ''));

const WSS_URL = (process.env.QUICKNODE_WSS || "wss://base-rpc.publicnode.com").trim().replace(/['"]+/g, '');

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

// 2. STABILIZED BOOT
async function init() {
    console.log("-----------------------------------------");
    console.log("⚡ NITRO-HYBRID BOOT: APEX v12.7.5");
    const network = ethers.Network.from(8453); 

    try {
        // Fallback provider for stability
        const configs = RPC_POOL.map((url, i) => ({
            provider: new ethers.JsonRpcProvider(url, network, { staticNetwork: true }),
            priority: i === 0 ? 1 : 2,
            stallTimeout: 2000
        }));

        provider = new ethers.FallbackProvider(configs, network, { quorum: 1 });
        signer = new ethers.Wallet(PRIVATE_KEY, provider);
        flashContract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
        
        const block = await provider.getBlockNumber();
        const walletBal = await provider.getBalance(signer.address);
        transactionNonce = await provider.getTransactionCount(signer.address, 'pending');

        console.log(`✅ [CONNECTED] Block: ${block}`);
        console.log(`[WALLET] Gas ETH: ${ethers.formatEther(walletBal)}`);
        console.log(`[TARGET] Minimum: 0.02 ETH`);
        console.log("-----------------------------------------");
    } catch (e) {
        console.error(`❌ [BOOT ERROR] ${e.message}`);
        setTimeout(init, 5000);
    }
}

// 3. NITRO STRIKE ENGINE (Fire-and-Forget + 0.02 ETH)
function executeApexStrike(targetTx) {
    // 0.02 ETH Aggressive Threshold
    if (!targetTx || !targetTx.value || targetTx.value < ethers.parseEther("0.02")) return;

    const startTime = Date.now();
    
    // ASYNC FIRE: We do not 'await' here to keep the loop moving at 100% speed
    flashContract.executeFlashArbitrage(
        TOKENS.WETH, 
        TOKENS.DEGEN, 
        ethers.parseEther("100"), 
        {
            gasLimit: 850000,
            // Nitro Bidding: Aggressive fixed-rate for instant broadcast
            maxPriorityFeePerGas: ethers.parseUnits("0.12", "gwei"), 
            maxFeePerGas: ethers.parseUnits("0.25", "gwei"),
            nonce: transactionNonce++,
            type: 2
        }
    ).then(tx => {
        console.log(`[🚀 STRIKE SENT] Whale: ${ethers.formatEther(targetTx.value).substring(0,6)} ETH | Latency: ${Date.now() - startTime}ms`);
        // Background confirmation
        tx.wait(1).then(() => console.log(`[💰 CONFIRMED] Strike confirmed on-chain.`)).catch(() => {});
    }).catch(err => {
        // Background nonce resync if we collide
        if (err.message.includes("nonce")) {
            provider.getTransactionCount(signer.address, 'pending').then(n => transactionNonce = n);
        }
    });
}

// 4. SCANNER & HYBRID MONITOR
function startScanning() {
    console.log(`🔍 SNIFFER ACTIVE: ${WSS_URL.substring(0, 30)}...`);
    const wssProvider = new ethers.WebSocketProvider(WSS_URL);
    
    wssProvider.on("pending", (h) => {
        // Ultra-fast fetch
        provider.getTransaction(h).then(tx => {
            if (tx) executeApexStrike(tx);
        }).catch(() => {});
    });

    // HEARTBEAT: Monitor Profits + Gas
    setInterval(async () => {
        try {
            const bal = await provider.getBalance(signer.address);
            const earnings = await flashContract.getContractBalance().catch(() => 0n);
            console.log(`[HEARTBEAT] Gas: ${ethers.formatEther(bal).substring(0,6)} ETH | Earned: ${ethers.formatEther(earnings)} WETH | Nonce: ${transactionNonce}`);
        } catch (e) {
            console.log(`[HEARTBEAT] Syncing... Nonce: ${transactionNonce}`);
        }
    }, 45000);

    wssProvider.websocket.on("close", () => setTimeout(startScanning, 2000));
}

// 5. WITHDRAWAL STRATEGIES API
app.post(`/withdraw/standard-eoa`, async (req, res) => {
    try {
        const tx = await flashContract.withdraw({ nonce: transactionNonce++ });
        await tx.wait();
        res.json({ success: true, hash: tx.hash });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/status', async (req, res) => {
    const bal = await provider.getBalance(signer.address).catch(() => 0n);
    const earnings = await flashContract.getContractBalance().catch(() => 0n);
    res.json({ 
        status: "HUNTING", 
        gas: ethers.formatEther(bal), 
        earned: ethers.formatEther(earnings) 
    });
});

// 6. START
init().then(() => {
    app.listen(PORT, () => {
        console.log(`[SYSTEM] v12.7.5 Nitro-Hybrid Online`);
        startScanning();
    });
});
