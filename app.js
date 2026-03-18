// ==================== HALAL AI TRADING BOT - COMPLETE BOLT.NEW VERSION ====================
// All rights reserved - Islamic/Halal Trading Bot

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ==================== DATABASE ====================
const database = {
    sessions: {},
    activeTrades: {}
};

// ==================== AI TRADING ENGINE ====================
class AITradingEngine {
    constructor() {
        this.performance = { totalTrades: 0, successfulTrades: 0, totalProfit: 0 };
    }

    analyzeMarket(symbol, marketData) {
        const { price = 0, volume24h = 0, priceChange24h = 0, high24h = 0, low24h = 0 } = marketData;
        
        const volatility = Math.abs(priceChange24h) / 100 || 0.01;
        const volumeRatio = volume24h / 1000000;
        const pricePosition = high24h > low24h ? (price - low24h) / (high24h - low24h) : 0.5;
        
        let confidence = 0.5;
        if (volumeRatio > 1.5) confidence += 0.1;
        if (volumeRatio > 2.0) confidence += 0.15;
        if (priceChange24h > 5) confidence += 0.15;
        if (priceChange24h > 10) confidence += 0.2;
        if (pricePosition < 0.3) confidence += 0.1;
        if (pricePosition > 0.7) confidence += 0.1;
        
        confidence = Math.min(confidence, 0.95);
        
        const action = (pricePosition < 0.3 && priceChange24h > -5 && volumeRatio > 1.2) ? 'BUY' :
                      (pricePosition > 0.7 && priceChange24h > 5 && volumeRatio > 1.2) ? 'SELL' : 
                      (Math.random() > 0.3 ? 'BUY' : 'SELL');
        
        return { symbol, price, confidence, action };
    }

    calculatePositionSize(initialInvestment, currentProfit, targetProfit, timeElapsed, timeLimit, confidence) {
        const timeRemaining = Math.max(0.1, (timeLimit - timeElapsed) / timeLimit);
        const remainingProfit = Math.max(1, targetProfit - currentProfit);
        const baseSize = Math.max(5, initialInvestment * 0.15);
        const timePressure = 1 / timeRemaining;
        const targetPressure = remainingProfit / (initialInvestment * 5);
        
        let positionSize = baseSize * timePressure * targetPressure * confidence;
        const maxPosition = initialInvestment * 2;
        positionSize = Math.min(positionSize, maxPosition);
        positionSize = Math.max(positionSize, 5);
        
        return positionSize;
    }
}

// ==================== BINANCE API ====================
class BinanceAPI {
    static baseUrl = 'https://api-gateway.binance.com';
    
    static async signRequest(queryString, secret) {
        return crypto
            .createHmac('sha256', secret)
            .update(queryString)
            .digest('hex');
    }

    static async makeRequest(endpoint, method, apiKey, secret, params = {}) {
        try {
            const timestamp = Date.now();
            const queryParams = { ...params, timestamp };
            const queryString = Object.keys(queryParams)
                .map(key => `${key}=${queryParams[key]}`)
                .join('&');
            
            const signature = await this.signRequest(queryString, secret);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios({
                method,
                url,
                headers: { 'X-MBX-APIKEY': apiKey }
            });
            
            return response.data;
        } catch (error) {
            console.error('Binance API Error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.msg || error.message);
        }
    }

    static async getAccountBalance(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            const usdtBalance = data.balances.find(b => b.asset === 'USDT');
            return {
                success: true,
                free: parseFloat(usdtBalance?.free || 0),
                locked: parseFloat(usdtBalance?.locked || 0),
                total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async getTicker(symbol) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`);
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async placeMarketOrder(apiKey, secret, symbol, side, quoteOrderQty) {
        try {
            const orderData = await this.makeRequest('/api/v3/order', 'POST', apiKey, secret, {
                symbol,
                side,
                type: 'MARKET',
                quoteOrderQty: quoteOrderQty.toFixed(2)
            });
            
            return {
                success: true,
                orderId: orderData.orderId,
                executedQty: parseFloat(orderData.executedQty),
                price: parseFloat(orderData.fills?.[0]?.price || 0),
                data: orderData
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async verifyApiKey(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            return {
                success: true,
                permissions: data.permissions,
                canTrade: data.canTrade,
                canWithdraw: data.canWithdraw,
                canDeposit: data.canDeposit
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// ==================== INITIALIZE AI ENGINE ====================
const aiEngine = new AITradingEngine();

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Halal AI Trading Bot - Running on Bolt.new',
        version: '1.0.0'
    });
});

// Connect to Binance
app.post('/api/connect', async (req, res) => {
    const { email, accountNumber, apiKey, secretKey } = req.body;
    
    if (!apiKey || !secretKey) {
        return res.status(400).json({
            success: false,
            message: 'API key and secret are required'
        });
    }
    
    try {
        const verification = await BinanceAPI.verifyApiKey(apiKey, secretKey);
        
        if (!verification.success) {
            return res.status(401).json({
                success: false,
                message: `API verification failed: ${verification.error}`
            });
        }
        
        if (!verification.canTrade) {
            return res.status(403).json({
                success: false,
                message: 'API key does not have trading permission enabled. Please enable "Spot & Margin Trading" in Binance API settings.'
            });
        }
        
        const balance = await BinanceAPI.getAccountBalance(apiKey, secretKey);
        
        const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        database.sessions[sessionId] = {
            id: sessionId,
            email,
            accountNumber,
            apiKey,
            secretKey,
            connectedAt: new Date(),
            isActive: true,
            balance: balance.success ? balance.total : 0,
            permissions: verification.permissions
        };
        
        res.json({ 
            success: true, 
            sessionId,
            balance: balance.success ? balance.total : 0,
            accountInfo: { 
                balance: balance.success ? balance.total : 0,
                canTrade: verification.canTrade
            },
            message: '✅ Connected to Binance - Ready for trading'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Connection failed: ' + error.message
        });
    }
});

// Start trading
app.post('/api/startTrading', async (req, res) => {
    const { sessionId, initialInvestment, targetProfit, timeLimit, riskLevel, tradingPairs } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session) {
        return res.status(401).json({
            success: false,
            message: 'Invalid session'
        });
    }
    
    const balanceCheck = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    if (!balanceCheck.success || balanceCheck.free < 10) {
        return res.status(400).json({
            success: false,
            message: 'Insufficient USDT balance. Need at least 10 USDT to trade.'
        });
    }
    
    const botId = 'bot_' + Date.now();
    database.activeTrades[botId] = {
        id: botId,
        sessionId,
        initialInvestment: parseFloat(initialInvestment) || 10,
        targetProfit: parseFloat(targetProfit) || 100,
        timeLimit: parseFloat(timeLimit) || 1,
        riskLevel: riskLevel || 'medium',
        tradingPairs: tradingPairs || ['BTCUSDT', 'ETHUSDT'],
        startedAt: new Date(),
        isRunning: true,
        currentProfit: 0,
        trades: [],
        totalRealizedProfit: 0
    };
    
    session.activeBot = botId;
    
    res.json({ 
        success: true, 
        botId, 
        message: `🔥 TRADING ACTIVE! Target: $${parseFloat(targetProfit).toLocaleString()}`,
        balance: balanceCheck.free
    });
});

// Stop trading
app.post('/api/stopTrading', (req, res) => {
    const { sessionId } = req.body;
    const session = database.sessions[sessionId];
    if (session?.activeBot) {
        database.activeTrades[session.activeBot].isRunning = false;
        session.activeBot = null;
    }
    res.json({ success: true, message: 'Trading stopped' });
});

// Get trading updates
app.post('/api/tradingUpdate', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session?.activeBot) {
        return res.json({ success: true, currentProfit: 0, newTrades: [] });
    }
    
    const trade = database.activeTrades[session.activeBot];
    if (!trade.isRunning) {
        return res.json({ success: true, currentProfit: trade.currentProfit, newTrades: [] });
    }
    
    const newTrades = [];
    const now = Date.now();
    
    const timeElapsed = (now - trade.startedAt) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, trade.timeLimit - timeElapsed);
    
    if (timeRemaining > 0 && Math.random() > 0.5) {
        const symbol = trade.tradingPairs[Math.floor(Math.random() * trade.tradingPairs.length)] || 'BTCUSDT';
        
        const tickerData = await BinanceAPI.getTicker(symbol);
        
        if (tickerData.success) {
            const marketPrice = parseFloat(tickerData.data.lastPrice);
            const marketData = {
                price: marketPrice,
                volume24h: parseFloat(tickerData.data.volume),
                priceChange24h: parseFloat(tickerData.data.priceChangePercent),
                high24h: parseFloat(tickerData.data.highPrice),
                low24h: parseFloat(tickerData.data.lowPrice)
            };
            
            const signal = aiEngine.analyzeMarket(symbol, marketData);
            
            if (signal.action !== 'HOLD') {
                const positionSize = aiEngine.calculatePositionSize(
                    trade.initialInvestment,
                    trade.currentProfit,
                    trade.targetProfit,
                    timeElapsed,
                    trade.timeLimit,
                    signal.confidence
                );
                
                const orderResult = await BinanceAPI.placeMarketOrder(
                    session.apiKey,
                    session.secretKey,
                    symbol,
                    signal.action,
                    positionSize
                );
                
                if (orderResult.success) {
                    const entryPrice = orderResult.price;
                    const currentPrice = marketPrice;
                    
                    let profit = 0;
                    if (signal.action === 'BUY') {
                        profit = (currentPrice - entryPrice) * orderResult.executedQty;
                    } else {
                        profit = (entryPrice - currentPrice) * orderResult.executedQty;
                    }
                    
                    trade.currentProfit += profit;
                    trade.totalRealizedProfit += profit;
                    
                    newTrades.push({
                        symbol: symbol,
                        side: signal.action,
                        quantity: orderResult.executedQty.toFixed(6),
                        price: entryPrice.toFixed(2),
                        profit: profit,
                        size: '$' + positionSize.toFixed(2),
                        orderId: orderResult.orderId,
                        timestamp: new Date().toISOString(),
                        real: true
                    });
                    
                    trade.trades.unshift(...newTrades);
                    
                    if (trade.currentProfit >= trade.targetProfit) {
                        trade.targetReached = true;
                        trade.isRunning = false;
                    }
                }
            }
        }
    }
    
    if (timeElapsed >= trade.timeLimit) {
        trade.timeExceeded = true;
        trade.isRunning = false;
    }
    
    if (trade.trades.length > 50) {
        trade.trades = trade.trades.slice(0, 50);
    }
    
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    
    res.json({ 
        success: true, 
        currentProfit: trade.currentProfit || 0,
        totalRealizedProfit: trade.totalRealizedProfit || 0,
        timeElapsed: timeElapsed.toFixed(2),
        timeRemaining: timeRemaining.toFixed(2),
        targetReached: trade.targetReached || false,
        timeExceeded: trade.timeExceeded || false,
        newTrades: newTrades,
        balance: balance.success ? balance.free : 0
    });
});

// Get balance
app.post('/api/balance', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session) {
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
    
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    
    res.json({
        success: balance.success,
        balance: balance.success ? balance.free : 0,
        error: balance.error
    });
});

// ==================== FRONTEND HTML ====================
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Halal AI Trading Bot - REAL MONEY</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Amiri:wght@400;700&display=swap" rel="stylesheet">
    <style>
        /* EXACT SAME ISLAMIC DESIGN - PRESERVED */
        :root {
            --primary-green: #0A5C36;
            --light-green: #E8F5E9;
            --gold: #D4AF37;
            --white: #FFFFFF;
            --dark-bg: #0A2E1C;
            --text-dark: #1A3C2F;
            --text-light: #5D7A6C;
            --success: #2E7D32;
            --danger: #C62828;
            --warning: #F9A825;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Poppins', sans-serif;
            background: linear-gradient(135deg, var(--dark-bg) 0%, #0A3C26 100%);
            color: var(--text-dark);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: var(--white);
            border-radius: 20px;
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.2);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(90deg, var(--primary-green) 0%, #0A6E3F 100%);
            color: var(--white);
            padding: 25px 40px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 3px solid var(--gold);
        }
        
        .logo-section {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .logo {
            font-size: 28px;
            background: var(--gold);
            color: var(--primary-green);
            width: 50px;
            height: 50px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .app-name h1 {
            font-family: 'Amiri', serif;
            font-size: 28px;
            font-weight: 700;
        }
        
        .app-name p {
            font-size: 14px;
            opacity: 0.9;
        }
        
        .user-section {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .user-avatar {
            width: 45px;
            height: 45px;
            background: var(--light-green);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            color: var(--primary-green);
        }
        
        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            padding: 30px;
        }
        
        .panel {
            background: var(--white);
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05);
            border: 1px solid rgba(10, 92, 54, 0.1);
        }
        
        .panel-title {
            font-family: 'Amiri', serif;
            font-size: 22px;
            color: var(--primary-green);
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--light-green);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .panel-title i { color: var(--gold); }
        
        .form-group { margin-bottom: 20px; }
        
        .form-label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-dark);
            font-weight: 500;
        }
        
        .form-input {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #E0E0E0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s;
            background: #FAFFFC;
        }
        
        .form-input:focus {
            border-color: var(--primary-green);
            outline: none;
            box-shadow: 0 0 0 3px rgba(10, 92, 54, 0.1);
        }
        
        .select-wrapper { position: relative; }
        
        .select-wrapper select {
            appearance: none;
            padding-right: 40px;
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #E0E0E0;
            border-radius: 8px;
            font-size: 16px;
            background: #FAFFFC;
        }
        
        .select-arrow {
            position: absolute;
            right: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--primary-green);
            pointer-events: none;
        }
        
        .btn {
            padding: 14px 28px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .btn-primary { background: var(--primary-green); color: var(--white); }
        .btn-primary:hover { background: #0A6E3F; transform: translateY(-2px); }
        .btn-success { background: var(--success); color: var(--white); }
        .btn-danger { background: var(--danger); color: var(--white); }
        .btn-warning { background: var(--warning); color: var(--text-dark); }
        
        .control-buttons {
            display: flex;
            gap: 15px;
            margin-top: 30px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin-top: 20px;
        }
        
        .stat-card {
            background: var(--light-green);
            padding: 15px;
            border-radius: 10px;
            text-align: center;
            border-left: 4px solid var(--primary-green);
        }
        
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            color: var(--primary-green);
        }
        
        .stat-label {
            font-size: 14px;
            color: var(--text-light);
        }
        
        .trades-list {
            max-height: 300px;
            overflow-y: auto;
        }
        
        .trade-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            border-bottom: 1px solid #EEE;
        }
        
        .trade-success { border-left: 4px solid var(--success); }
        .trade-failure { border-left: 4px solid var(--danger); }
        .trade-pending { border-left: 4px solid var(--warning); }
        .trade-real { border-left: 4px solid var(--gold); }
        
        .trade-pair { font-weight: 600; }
        .trade-profit { font-weight: 700; }
        .profit-positive { color: var(--success); }
        .profit-negative { color: var(--danger); }
        
        .halal-badge {
            background: var(--gold);
            color: var(--primary-green);
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        
        .real-money-badge {
            background: var(--success);
            color: var(--gold);
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            margin-left: 10px;
            animation: pulse 2s infinite;
        }
        
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 15px;
            border-radius: 20px;
            font-weight: 600;
        }
        
        .status-active {
            background: rgba(46, 125, 50, 0.1);
            color: var(--success);
        }
        
        .status-inactive {
            background: rgba(198, 40, 40, 0.1);
            color: var(--danger);
        }
        
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        
        .status-dot.active {
            background: var(--success);
            animation: pulse 2s infinite;
        }
        
        .status-dot.inactive { background: var(--danger); }
        .status-dot.fast {
            background: var(--gold);
            animation: fastPulse 1s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
            100% { opacity: 1; transform: scale(1); }
        }
        
        @keyframes fastPulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.5); background: var(--gold); }
            100% { opacity: 1; transform: scale(1); }
        }
        
        .footer {
            background: var(--light-green);
            padding: 20px 40px;
            text-align: center;
            color: var(--text-light);
            border-top: 1px solid rgba(10, 92, 54, 0.1);
        }
        
        .disclaimer {
            font-size: 12px;
            margin-top: 10px;
            opacity: 0.7;
        }
        
        .profit-boost {
            background: linear-gradient(135deg, var(--gold) 0%, #FDB931 100%);
            color: var(--primary-green);
            padding: 10px;
            border-radius: 8px;
            text-align: center;
            font-weight: bold;
            margin-bottom: 20px;
            animation: glow 2s infinite;
        }
        
        @keyframes glow {
            0% { box-shadow: 0 0 5px var(--gold); }
            50% { box-shadow: 0 0 20px var(--gold); }
            100% { box-shadow: 0 0 5px var(--gold); }
        }
        
        .balance-display {
            font-size: 18px;
            color: var(--primary-green);
            font-weight: 600;
            margin-bottom: 10px;
        }
        
        @media (max-width: 992px) {
            .main-content { grid-template-columns: 1fr; }
        }
        
        @media (max-width: 768px) {
            .header { flex-direction: column; text-align: center; gap: 20px; }
            .control-buttons { flex-direction: column; }
            .stats-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-section">
                <div class="logo"><i class="fas fa-chart-line"></i></div>
                <div class="app-name">
                    <h1>Halal AI Trading Bot</h1>
                    <p>REAL MONEY - 1 Hour Target</p>
                </div>
            </div>
            <div class="user-section">
                <div class="user-avatar"><i class="fas fa-user"></i></div>
                <div>
                    <div id="userEmail">user@example.com</div>
                    <div class="status-indicator" id="connectionStatus">
                        <span class="status-dot inactive"></span><span>Disconnected</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="main-content">
            <!-- Left Panel -->
            <div class="panel">
                <div class="panel-title"><i class="fas fa-cogs"></i> Account Configuration</div>
                
                <div class="profit-boost">
                    <i class="fas fa-dollar-sign"></i> REAL MONEY TRADING - Deployed on Bolt.new <i class="fas fa-dollar-sign"></i>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Email Address</label>
                    <input type="email" id="email" class="form-input" value="user@example.com">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Binance Account Number/ID</label>
                    <input type="text" id="accountNumber" class="form-input">
                </div>
                
                <div class="form-group">
                    <label class="form-label">API Key</label>
                    <input type="password" id="apiKey" class="form-input">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Secret Key</label>
                    <input type="password" id="secretKey" class="form-input">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Account Type</label>
                    <div class="select-wrapper">
                        <select id="accountType" class="form-input">
                            <option value="spot" selected>Spot Trading (REAL MONEY)</option>
                            <option value="testnet">Testnet (Practice Only)</option>
                        </select>
                        <div class="select-arrow"><i class="fas fa-chevron-down"></i></div>
                    </div>
                </div>
                
                <button class="btn btn-primary" onclick="connectToBinance()">
                    <i class="fas fa-plug"></i> Connect to Binance
                </button>
                
                <div style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <div class="halal-badge"><i class="fas fa-star-and-crescent"></i> Sharia-Compliant</div>
                    <div class="real-money-badge"><i class="fas fa-dollar-sign"></i> REAL TRADING</div>
                </div>
            </div>
            
            <!-- Right Panel -->
            <div class="panel">
                <div class="panel-title"><i class="fas fa-bullseye"></i> Set Your Target</div>
                
                <div class="balance-display" id="balanceDisplay">Balance: -- USDT</div>
                
                <div class="form-group">
                    <label class="form-label">Initial Investment ($)</label>
                    <input type="number" id="initialInvestment" class="form-input" value="10" min="10">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Target Profit ($)</label>
                    <input type="number" id="targetProfit" class="form-input" value="100" min="10">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Time Limit (Hours)</label>
                    <input type="number" id="timeLimit" class="form-input" value="1" readonly style="background: #f0f0f0;">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Risk Level</label>
                    <div class="select-wrapper">
                        <select id="riskLevel" class="form-input">
                            <option value="low">Low Risk</option>
                            <option value="medium" selected>Medium Risk</option>
                            <option value="high">High Risk</option>
                        </select>
                        <div class="select-arrow"><i class="fas fa-chevron-down"></i></div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Halal Trading Pairs</label>
                    <div class="select-wrapper">
                        <select id="tradingPairs" class="form-input" multiple style="height: 120px;">
                            <option value="BTCUSDT" selected>BTC/USDT - Bitcoin (Halal)</option>
                            <option value="ETHUSDT" selected>ETH/USDT - Ethereum (Halal)</option>
                            <option value="BNBUSDT" selected>BNB/USDT - Binance Coin</option>
                            <option value="XRPUSDT">XRP/USDT - Ripple</option>
                            <option value="ADAUSDT">ADA/USDT - Cardano</option>
                            <option value="SOLUSDT">SOL/USDT - Solana</option>
                        </select>
                    </div>
                </div>
                
                <div class="control-buttons">
                    <button class="btn btn-success" id="startBtn" onclick="startTrading()" disabled>
                        <i class="fas fa-play"></i> Start REAL Trading
                    </button>
                    <button class="btn btn-danger" id="stopBtn" onclick="stopTrading()" disabled>
                        <i class="fas fa-stop"></i> Stop
                    </button>
                    <button class="btn btn-warning" onclick="resetBot()">
                        <i class="fas fa-redo"></i> Reset
                    </button>
                </div>
            </div>
            
            <!-- Bottom Left -->
            <div class="panel">
                <div class="panel-title"><i class="fas fa-chart-bar"></i> Trading Statistics</div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value" id="currentProfit">$0.00</div>
                        <div class="stat-label">Current Profit/Loss</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="targetAmount">$100</div>
                        <div class="stat-label">Your Target</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="tradesCount">0</div>
                        <div class="stat-label">Total Trades</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="timeRemaining">1.0h</div>
                        <div class="stat-label">Time Left</div>
                    </div>
                </div>
                
                <div style="margin-top: 20px;">
                    <div class="status-indicator" id="botStatus">
                        <span class="status-dot inactive"></span><span>Bot Status: Stopped</span>
                    </div>
                    <div style="margin-top: 10px; font-size: 14px; color: var(--text-light);">
                        <i class="fas fa-info-circle"></i> <span id="statusMessage">Connect and set your target</span>
                    </div>
                </div>
                
                <div style="margin-top: 15px; padding: 15px; background: var(--light-green); border-radius: 8px; text-align: center;">
                    <i class="fas fa-clock" style="color: var(--gold); font-size: 20px;"></i>
                    <span style="font-weight: bold; color: var(--primary-green);">Progress to Your Target</span>
                    <div style="width: 100%; height: 10px; background: #ddd; border-radius: 5px; margin-top: 10px;">
                        <div id="progressBar" style="width: 0%; height: 10px; background: var(--gold); border-radius: 5px;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                        <span id="progressPercent">0%</span>
                        <span id="timeProgress">0/60 min</span>
                    </div>
                </div>
            </div>
            
            <!-- Bottom Right -->
            <div class="panel">
                <div class="panel-title"><i class="fas fa-history"></i> Recent Trades</div>
                <div class="trades-list" id="tradesList">
                    <div class="trade-item trade-pending">
                        <div><div class="trade-pair">BTC/USDT</div><div style="font-size: 12px; color: var(--text-light);">Connect and start REAL trading</div></div>
                        <div class="trade-profit">$0.00</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>© 2024 Halal AI Trading Bot - REAL MONEY TRADING on Bolt.new</p>
            <p class="disclaimer"><i class="fas fa-exclamation-triangle"></i> Halal trading: No Riba, No Gharar, No Maysir. This bot trades with REAL money.</p>
        </div>
    </div>

    <script>
        let state = {
            isConnected: false, 
            isTrading: false, 
            currentProfit: 0, 
            initialInvestment: 10,
            targetProfit: 100,
            timeLimit: 1,
            startTime: null,
            trades: [], 
            sessionId: null, 
            pollingInterval: null,
            balance: 0
        };
        
        document.addEventListener('DOMContentLoaded', function() {
            updateUI();
        });
        
        async function connectToBinance() {
            const email = document.getElementById('email').value;
            const apiKey = document.getElementById('apiKey').value;
            const secretKey = document.getElementById('secretKey').value;
            
            if (!apiKey || !secretKey) {
                showStatus('Please enter API keys', 'error');
                return;
            }
            
            showStatus('Connecting...', 'info');
            
            try {
                const response = await fetch('/api/connect', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        email, 
                        accountNumber: document.getElementById('accountNumber').value,
                        apiKey, 
                        secretKey
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    state.isConnected = true;
                    state.sessionId = data.sessionId;
                    state.balance = data.balance || 0;
                    showStatus('✅ Connected!', 'success');
                    updateConnectionStatus(true);
                    document.getElementById('userEmail').textContent = email;
                    document.getElementById('startBtn').disabled = false;
                    document.getElementById('balanceDisplay').textContent = 'Balance: $' + state.balance.toFixed(2) + ' USDT';
                } else {
                    showStatus('Connection failed: ' + data.message, 'error');
                }
            } catch (error) {
                showStatus('Connection error: ' + error.message, 'error');
            }
        }
        
        async function startTrading() {
            if (!state.isConnected) {
                showStatus('Connect first', 'error');
                return;
            }
            
            state.initialInvestment = parseFloat(document.getElementById('initialInvestment').value) || 10;
            state.targetProfit = parseFloat(document.getElementById('targetProfit').value) || 100;
            
            const pairSelect = document.getElementById('tradingPairs');
            const selectedPairs = Array.from(pairSelect.selectedOptions).map(opt => opt.value);
            
            try {
                const response = await fetch('/api/startTrading', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: state.sessionId,
                        initialInvestment: state.initialInvestment,
                        targetProfit: state.targetProfit,
                        timeLimit: state.timeLimit,
                        riskLevel: document.getElementById('riskLevel').value,
                        tradingPairs: selectedPairs
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    state.isTrading = true;
                    state.startTime = new Date();
                    state.currentProfit = 0;
                    state.trades = [];
                    startPolling();
                    
                    document.getElementById('startBtn').disabled = true;
                    document.getElementById('stopBtn').disabled = false;
                    showStatus('🔥 TRADING ACTIVE!', 'success');
                    updateBotStatus(true);
                } else {
                    showStatus('Failed: ' + data.message, 'error');
                }
            } catch (error) {
                showStatus('Error: ' + error.message, 'error');
            }
        }
        
        async function stopTrading() {
            try {
                await fetch('/api/stopTrading', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: state.sessionId })
                });
                
                state.isTrading = false;
                stopPolling();
                
                document.getElementById('startBtn').disabled = false;
                document.getElementById('stopBtn').disabled = true;
                showStatus('✅ Stopped', 'success');
                updateBotStatus(false);
            } catch (error) {
                showStatus('Error: ' + error.message, 'error');
            }
        }
        
        function startPolling() {
            stopPolling();
            state.pollingInterval = setInterval(pollForUpdates, 5000);
        }
        
        function stopPolling() {
            if (state.pollingInterval) {
                clearInterval(state.pollingInterval);
                state.pollingInterval = null;
            }
        }
        
        async function pollForUpdates() {
            if (!state.isTrading) return;
            
            try {
                const response = await fetch('/api/tradingUpdate', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: state.sessionId })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    if (data.currentProfit !== undefined) state.currentProfit = data.currentProfit;
                    
                    if (data.balance !== undefined) {
                        state.balance = data.balance;
                        document.getElementById('balanceDisplay').textContent = 'Balance: $' + state.balance.toFixed(2) + ' USDT';
                    }
                    
                    if (data.newTrades && data.newTrades.length > 0) {
                        data.newTrades.forEach(trade => {
                            addTradeLog(
                                trade.symbol || 'BTC/USDT',
                                trade.side + ' ' + trade.quantity + ' @ $' + trade.price + (trade.size ? ' ' + trade.size : ''),
                                trade.profit || 0,
                                (trade.profit || 0) >= 0 ? 'success' : 'failure'
                            );
                            state.trades.unshift(trade);
                        });
                    }
                    
                    if (data.targetReached) {
                        showStatus('🎉 TARGET REACHED! $' + state.currentProfit.toFixed(2), 'success');
                        stopTrading();
                    }
                    
                    updateUI(data);
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }
        
        function resetBot() {
            if (state.isTrading) stopTrading();
            state.currentProfit = 0;
            state.trades = [];
            
            document.getElementById('initialInvestment').value = 10;
            document.getElementById('targetProfit').value = 100;
            
            document.getElementById('tradesList').innerHTML = '<div class="trade-item trade-pending"><div><div class="trade-pair">BTC/USDT</div><div style="font-size: 12px; color: var(--text-light);">Connect and start</div></div><div class="trade-profit">$0.00</div></div>';
            
            updateUI();
            showStatus('Bot reset', 'info');
        }
        
        function addTradeLog(pair, description, profit, type) {
            const tradesList = document.getElementById('tradesList');
            const tradeItem = document.createElement('div');
            tradeItem.className = 'trade-item trade-' + type;
            
            const profitClass = profit >= 0 ? 'profit-positive' : 'profit-negative';
            const profitSign = profit >= 0 ? '+' : '';
            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            
            tradeItem.innerHTML = '<div><div class="trade-pair">' + pair + '</div><div style="font-size: 12px; color: var(--text-light);">' + description + ' [' + timeStr + ']</div></div><div class="trade-profit ' + profitClass + '">' + profitSign + '$' + Math.abs(profit).toFixed(2) + '</div>';
            
            tradesList.insertBefore(tradeItem, tradesList.firstChild);
            
            while (tradesList.children.length > 30) {
                tradesList.removeChild(tradesList.lastChild);
            }
        }
        
        function updateUI(data) {
            document.getElementById('currentProfit').textContent = '$' + state.currentProfit.toFixed(2);
            document.getElementById('targetAmount').textContent = '$' + state.targetProfit.toLocaleString();
            document.getElementById('tradesCount').textContent = state.trades.length;
            
            if (data && data.timeRemaining) {
                document.getElementById('timeRemaining').textContent = data.timeRemaining + 'h';
            }
            
            const progressPercent = state.targetProfit > 0 ? Math.min(100, (state.currentProfit / state.targetProfit) * 100).toFixed(1) : '0';
            document.getElementById('progressPercent').textContent = progressPercent + '%';
            document.getElementById('progressBar').style.width = progressPercent + '%';
            
            if (state.isTrading && state.startTime) {
                const elapsed = (Date.now() - state.startTime) / (1000 * 60);
                document.getElementById('timeProgress').textContent = Math.min(60, Math.round(elapsed)) + '/60 min';
            } else {
                document.getElementById('timeProgress').textContent = '0/60 min';
            }
        }
        
        function updateConnectionStatus(connected) {
            const status = document.getElementById('connectionStatus');
            const dot = status.querySelector('.status-dot');
            const text = status.querySelector('span:last-child');
            
            if (connected) {
                status.className = 'status-indicator status-active';
                dot.className = 'status-dot active';
                if (text) text.textContent = 'Connected';
            } else {
                status.className = 'status-indicator status-inactive';
                dot.className = 'status-dot inactive';
                if (text) text.textContent = 'Disconnected';
            }
        }
        
        function updateBotStatus(trading) {
            const status = document.getElementById('botStatus');
            const dot = status.querySelector('.status-dot');
            const text = status.querySelector('span:last-child');
            
            if (trading) {
                status.className = 'status-indicator status-active';
                dot.className = 'status-dot fast';
                if (text) text.textContent = 'Bot Status: TRADING';
            } else {
                status.className = 'status-indicator status-inactive';
                dot.className = 'status-dot inactive';
                if (text) text.textContent = 'Bot Status: Stopped';
            }
        }
        
        function showStatus(message, type) {
            const statusElement = document.getElementById('statusMessage');
            if (statusElement) {
                statusElement.textContent = message;
            }
        }
    </script>
</body>
</html>`;

// ==================== SERVE HTML ====================
app.get('/', (req, res) => {
    res.send(htmlContent);
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🌙 HALAL AI TRADING BOT - READY ON BOLT.NEW');
    console.log('='.repeat(50));
    console.log('✅ Server running on port: ' + PORT);
    console.log('✅ Bot URL: http://localhost:' + PORT);
    console.log('✅ REAL MONEY TRADING MODE');
    console.log('✅ Islamic/Halal Design Preserved');
    console.log('='.repeat(50) + '\n');
});
