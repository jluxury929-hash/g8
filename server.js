// ===============================================================================
// APEX UNIFIED MASTER v12.6.5 (FINAL STABILIZED + PROFIT MONITOR)
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
    "https://base.llamarpc.com",
    "https://base.drpc.org"
].filter(url => url && url.includes('http')).map(u => u.trim().replace(/['"]+/g, ''));

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
    console.log("🛡️ BOOTING APEX UNIFIED v12.6.5...");
    const network = ethers.Network.from(8453); 

    try {
        const configs = RPC_POOL.map((url, i) => ({
            provider: new ethers.JsonRpcProvider(url, network, { staticNetwork: true }),
            priority: i === 0 ? 1 : 2,
            stallTimeout: 2500
        }));

        provider = new ethers.FallbackProvider(configs, network, { quorum: 1 });
        signer = new ethers.Wallet(PRIVATE_KEY, provider);
        flashContract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
        
        const block = await provider.getBlockNumber();
        const walletBal = await provider.getBalance(signer.address);
        transactionNonce = await provider.getTransactionCount(signer.address, 'pending');

        console.log(`✅ [CONNECTED] Block: ${block}`);
        console.log(`[WALLET] Gas ETH: ${ethers.formatEther(walletBal)}`);
        console.log(`[NONCE]  Next ID: ${transactionNonce}`);
        console.log("-----------------------------------------");
    } catch (e) {
        console.error(`❌ [BOOT ERROR] ${e.message}`);
        setTimeout(init, 5000);
    }
}

// 3. APEX STRIKE ENGINE (The Fix)
async function executeApexStrike(targetTx) {
    try {
        if (!targetTx || !targetTx.to || targetTx.value < ethers.parseEther("0.05")) return;
        
        // FORCE BALANCE RE-CHECK (Avoids the 0.0 ETH RPC Lag bug)
        let balance = await provider.getBalance(signer.address);
        if (balance < ethers.parseEther("0.001")) {
            // Try one more time with primary RPC if it shows zero
            balance = await new ethers.JsonRpcProvider(RPC_POOL[0]).getBalance(signer.address);
        }

        if (balance < ethers.parseEther("0.0008")) {
            console.log(`[⚠️ SKIP] Gas too low to bid: ${ethers.formatEther(balance)} ETH`);
            return;
        }

        console.log(`[🎯 TARGET] Whale: ${ethers.formatEther(targetTx.value)} ETH. Bidding...`);

        const feeData = await provider.getFeeData();
        const strike = await flashContract.executeFlashArbitrage(
            TOKENS.WETH, TOKENS.DEGEN, ethers.parseEther("100"), 
            {
                gasLimit: 850000,
                // Aggressive 5x Priority bidding to beat other MEVs
                maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 5n), 
                maxFeePerGas: (feeData.maxFeePerGas * 2n),
                nonce: transactionNonce++,
                type: 2
            }
        );

        console.log(`[🚀 STRIKE SENT] Tx: ${strike.hash}`);
        
        // Non-blocking wait (background confirm)
        strike.wait(1).then(() => console.log(`[💰 CONFIRMED] Strike success.`)).catch(() => {});

    } catch (e) {
        if (e.message.includes("nonce")) {
            transactionNonce = await provider.getTransactionCount(signer.address, 'pending');
        }
    }
}

// 4. SCANNER & HEARTBEAT (Added Contract Balance Monitor)
function startScanning() {
    console.log(`🔍 SNIFFER LIVE: ${WSS_URL.substring(0, 30)}...`);
    const wssProvider = new ethers.WebSocketProvider(WSS_URL);
    
    wssProvider.on("pending", async (h) => {
        const tx = await provider.getTransaction(h).catch(() => null);
        if (tx) executeApexStrike(tx);
    });

    // REVISED HEARTBEAT: Shows your earned profits sitting in the contract
    setInterval(async () => {
        try {
            const bal = await provider.getBalance(signer.address);
            const earnings = await flashContract.getContractBalance();
            console.log(`[HEARTBEAT] Gas: ${ethers.formatEther(bal)} ETH | Earned: ${ethers.formatEther(earnings)} WETH | Nonce: ${transactionNonce}`);
        } catch (e) {
            console.log(`[HEARTBEAT] Syncing... Nonce: ${transactionNonce}`);
        }
    }, 60000);

    wssProvider.websocket.on("close", () => setTimeout(startScanning, 5000));
}

// 5. WITHDRAWAL STRATEGIES API
const STRATS = ['standard-eoa', 'check-before', 'check-after', 'micro-split-3', 'max-priority'];

STRATS.forEach(id => {
    app.post(`/withdraw/${id}`, async (req, res) => {
        try {
            // This calls the smart contract's withdraw function to send ETH to your payout wallet
            const tx = await flashContract.withdraw({ nonce: transactionNonce++ });
            await tx.wait();
            res.json({ success: true, hash: tx.hash });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

app.get('/status', async (req, res) => {
    const bal = await provider.getBalance(signer.address).catch(() => 0n);
    const earnings = await flashContract.getContractBalance().catch(() => 0n);
    res.json({ 
        status: "HUNTING", 
        gas_eth: ethers.formatEther(bal), 
        earned_weth: ethers.formatEther(earnings) 
    });
});

// 6. START
init().then(() => {
    app.listen(PORT, () => {
        console.log(`[SYSTEM] v12.6.5 Master Online`);
        startScanning();
    });
});
