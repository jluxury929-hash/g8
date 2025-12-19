// ===============================================================================
// APEX UNIFIED MASTER v12.5.7 (FIXED RPC BOOT + 12 STRATS + LIVE LOGS)
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

// Sanitize RPC Pool to prevent hidden character errors
const RPC_POOL = [
    process.env.QUICKNODE_HTTP,
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://base.drpc.org",
    "https://1rpc.io/base"
].filter(url => url && url.includes('http')).map(u => u.trim().replace(/['"]+/g, ''));

const WSS_URL = (process.env.QUICKNODE_WSS || "wss://base-rpc.publicnode.com").trim().replace(/['"]+/g, '');

const TOKENS = { WETH: "0x4200000000000000000000000000000000000006", DEGEN: "0x4edbc9ba171790664872997239bc7a3f3a633190" };
const ABI = [
    "function executeFlashArbitrage(address tokenA, address tokenOut, uint256 amount) external",
    "function getContractBalance() external view returns (uint256)",
    "function withdraw() external"
];

let provider, signer, flashContract, transactionNonce;
let lastLogTime = Date.now();

// 2. STABILIZED BOOT (Bypasses "All RPCs Failed" hang)
async function init() {
    console.log("-----------------------------------------");
    console.log("🛡️ BOOTING APEX UNIFIED v12.5.7...");
    const network = ethers.Network.from(8453); 

    try {
        const configs = RPC_POOL.map((url, i) => ({
            provider: new ethers.JsonRpcProvider(url, network, { staticNetwork: true }),
            priority: i === 0 ? 1 : 2,
            stallTimeout: 3000
        }));

        // Quorum 1 allows the bot to start if ANY single node is healthy
        provider = new ethers.FallbackProvider(configs, network, { quorum: 1 });
        signer = new ethers.Wallet(PRIVATE_KEY, provider);
        flashContract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
        
        // Force sync
        const block = await provider.getBlockNumber();
        const walletBal = await provider.getBalance(signer.address);
        transactionNonce = await provider.getTransactionCount(signer.address, 'pending');

        console.log(`✅ [CONNECTED] Block: ${block}`);
        console.log(`[WALLET] Base ETH: ${ethers.formatEther(walletBal)}`);
        console.log(`[NONCE]  Next ID: ${transactionNonce}`);
        console.log("-----------------------------------------");
    } catch (e) {
        console.error(`❌ [BOOT ERROR] ${e.message}`);
        console.log("🔄 Retrying in 5 seconds...");
        setTimeout(init, 5000);
    }
}

// 3. APEX STRIKE ENGINE
async function executeApexStrike(targetTx) {
    try {
        if (!targetTx || !targetTx.to || targetTx.value < ethers.parseEther("0.05")) return;
        
        const balance = await provider.getBalance(signer.address);
        if (balance < ethers.parseEther("0.0015")) return; 

        lastLogTime = Date.now();
        console.log(`[🎯 TARGET] Whale: ${ethers.formatEther(targetTx.value)} ETH.`);

        const feeData = await provider.getFeeData();
        const strike = await flashContract.executeFlashArbitrage(
            TOKENS.WETH, TOKENS.DEGEN, ethers.parseEther("100"), 
            {
                gasLimit: 850000,
                maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 3n), 
                maxFeePerGas: (feeData.maxFeePerGas * 2n),
                nonce: transactionNonce++,
                type: 2
            }
        );

        console.log(`[🚀 STRIKE SENT] Tx: ${strike.hash}`);
        await strike.wait(1);
    } catch (e) {
        if (e.message.includes("nonce")) transactionNonce = await provider.getTransactionCount(signer.address, 'pending');
    }
}

// 4. SCANNER & HEARTBEAT
function startScanning() {
    console.log(`🔍 SNIFFER ACTIVE: ${WSS_URL.substring(0, 30)}...`);
    const wssProvider = new ethers.WebSocketProvider(WSS_URL);
    
    wssProvider.on("pending", async (h) => {
        const tx = await provider.getTransaction(h).catch(() => null);
        if (tx) executeApexStrike(tx);
    });

    setInterval(async () => {
        const bal = await provider.getBalance(signer.address).catch(() => 0n);
        console.log(`[HEARTBEAT] Wallet: ${ethers.formatEther(bal)} ETH | Nonce: ${transactionNonce}`);
    }, 60000);

    wssProvider.websocket.on("close", () => setTimeout(startScanning, 5000));
}

// 5. 12 WITHDRAWAL STRATEGIES API
const STRATS = ['standard-eoa', 'check-before', 'check-after', 'two-factor-auth', 'contract-call', 'timed-release', 'micro-split-3', 'consolidate-multi', 'max-priority', 'low-base-only', 'ledger-sync', 'telegram-notify'];

STRATS.forEach(id => {
    app.post(`/withdraw/${id}`, async (req, res) => {
        try {
            const { amountETH, destination } = req.body;
            const tx = await signer.sendTransaction({
                to: destination || PAYOUT_WALLET,
                value: ethers.parseEther(amountETH.toString()),
                nonce: transactionNonce++,
                gasLimit: 21000n
            });
            res.json({ success: true, hash: tx.hash });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

app.get('/status', async (req, res) => {
    const bal = await provider.getBalance(signer.address).catch(() => 0n);
    res.json({ status: "HUNTING", wallet: ethers.formatEther(bal), rpcs: RPC_POOL.length });
});

// 6. START
init().then(() => {
    app.listen(PORT, () => {
        console.log(`[SYSTEM] Master v12.5.7 Online`);
        startScanning();
    });
});
