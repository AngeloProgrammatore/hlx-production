const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const app = express();

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// API Keys (server-side — never exposed to browser)
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const LOJA_API_KEY = process.env.LOJA_API_KEY || '9d8d54c8437bfbe17341';
const LOJA_APP_KEY = process.env.LOJA_APP_KEY || '0e99a708-3383-48ad-8116-e7a35126dbf6';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname)); // serve HTML + assets

// ─── Ensure data dirs exist ──────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Initialize products file if missing
if (!fs.existsSync(PRODUCTS_FILE)) {
    const src = path.join(__dirname, 'products.json');
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, PRODUCTS_FILE);
        console.log('✅ Initialized products from products.json');
    } else {
        fs.writeFileSync(PRODUCTS_FILE, '[]');
        console.log('⚠️ Created empty products.json');
    }
}

// ─── Helper: read/write products ─────────────────────────────────────────────
function readProducts() {
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
}

function writeProducts(products) {
    // Auto-backup before write (keep last 20)
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort();
    if (backups.length >= 20) {
        fs.unlinkSync(path.join(BACKUP_DIR, backups[0]));
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUP_DIR, `products-${ts}.json`), JSON.stringify(readProducts(), null, 2));

    // Write new data
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

// ═════════════════════════════════════════════════════════════════════════════
// PRODUCTS API
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/products — load all products
app.get('/api/products', (req, res) => {
    try {
        res.json(readProducts());
    } catch (e) {
        res.status(500).json({ error: 'Failed to read products', detail: e.message });
    }
});

// POST /api/products — add a new product
app.post('/api/products', (req, res) => {
    try {
        const products = readProducts();
        const newProduct = req.body;

        // Validate required fields
        if (!newProduct.cat || !newProduct.estoqueNome) {
            return res.status(400).json({ error: 'cat and estoqueNome are required' });
        }

        // Ensure defaults
        if (!newProduct.venditeNome) newProduct.venditeNome = newProduct.estoqueNome;
        if (!newProduct.sku) newProduct.sku = '';
        if (!newProduct.skuLoja) newProduct.skuLoja = '';
        if (!newProduct.img) newProduct.img = '';
        if (!newProduct.stock) newProduct.stock = {};
        if (!newProduct.vendite) newProduct.vendite = [0,0,0,0,0,0,0,0,0,0,0,0];

        products.push(newProduct);
        writeProducts(products);

        console.log(`➕ Product added: ${newProduct.estoqueNome} (total: ${products.length})`);
        res.json({ success: true, index: products.length - 1, total: products.length });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add product', detail: e.message });
    }
});

// PUT /api/products/:index — update a product (stock, name, etc.)
app.put('/api/products/:index', (req, res) => {
    try {
        const products = readProducts();
        const idx = parseInt(req.params.index);

        if (idx < 0 || idx >= products.length) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const updates = req.body;

        // Merge updates into existing product
        Object.keys(updates).forEach(key => {
            if (key === 'stock' && typeof updates.stock === 'object') {
                // Deep merge stock
                if (!products[idx].stock) products[idx].stock = {};
                Object.keys(updates.stock).forEach(size => {
                    products[idx].stock[size] = updates.stock[size];
                });
            } else {
                products[idx][key] = updates[key];
            }
        });

        writeProducts(products);
        console.log(`✏️ Product updated: ${products[idx].estoqueNome} [${idx}]`);
        res.json({ success: true, product: products[idx] });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update product', detail: e.message });
    }
});

// DELETE /api/products/:index — delete a product
app.delete('/api/products/:index', (req, res) => {
    try {
        const products = readProducts();
        const idx = parseInt(req.params.index);

        if (idx < 0 || idx >= products.length) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const removed = products.splice(idx, 1)[0];
        writeProducts(products);

        console.log(`🗑️ Product deleted: ${removed.estoqueNome} (remaining: ${products.length})`);
        res.json({ success: true, removed: removed.estoqueNome, total: products.length });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete product', detail: e.message });
    }
});

// PUT /api/products/:index/stock — update stock for specific sizes
app.put('/api/products/:index/stock', (req, res) => {
    try {
        const products = readProducts();
        const idx = parseInt(req.params.index);

        if (idx < 0 || idx >= products.length) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const stockUpdates = req.body; // { "38": { e: 10, p: 5 }, ... }
        if (!products[idx].stock) products[idx].stock = {};

        Object.keys(stockUpdates).forEach(size => {
            products[idx].stock[size] = stockUpdates[size];
        });

        writeProducts(products);
        console.log(`📦 Stock updated: ${products[idx].estoqueNome} [${idx}]`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update stock', detail: e.message });
    }
});

// POST /api/products/reorder — bulk save (full array replacement)
app.post('/api/products/reorder', (req, res) => {
    try {
        const products = req.body;
        if (!Array.isArray(products)) {
            return res.status(400).json({ error: 'Expected array of products' });
        }
        writeProducts(products);
        console.log(`🔄 Full product list saved (${products.length} products)`);
        res.json({ success: true, total: products.length });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save products', detail: e.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// ANTHROPIC AI PROXY
// ═════════════════════════════════════════════════════════════════════════════

app.post('/api/ai', async (req, res) => {
    if (!ANTHROPIC_KEY) {
        return res.status(500).json({ error: 'Anthropic API key not configured on server' });
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ error: 'AI proxy failed', detail: e.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// LOJA INTEGRADA PROXY
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/loja/*', async (req, res) => {
    try {
        const lojaPath = req.params[0]; // everything after /api/loja/
        const sep = lojaPath.includes('?') ? '&' : '?';
        const url = `https://api.awsli.com.br/v1/${lojaPath}${sep}chave_api=${LOJA_API_KEY}&chave_aplicacao=${LOJA_APP_KEY}`;

        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ error: 'Loja proxy failed', detail: e.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG API (for checking if AI key is configured)
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/config', (req, res) => {
    res.json({
        hasAiKey: !!ANTHROPIC_KEY,
        hasLojaKey: !!LOJA_API_KEY,
        version: '1.0.0',
        products: readProducts().length
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// BACKUPS API
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/backups', (req, res) => {
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse();
    res.json(backups);
});

app.post('/api/backups/restore/:filename', (req, res) => {
    try {
        const file = path.join(BACKUP_DIR, req.params.filename);
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' });

        const backupData = JSON.parse(fs.readFileSync(file, 'utf8'));
        writeProducts(backupData);
        console.log(`♻️ Restored from backup: ${req.params.filename}`);
        res.json({ success: true, products: backupData.length });
    } catch (e) {
        res.status(500).json({ error: 'Restore failed', detail: e.message });
    }
});

// ─── Fallback: serve index.html ──────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'hlx-stock-system.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    const products = readProducts();
    console.log(`
╔══════════════════════════════════════════════╗
║   HLX Stock System — Server Running         ║
╠══════════════════════════════════════════════╣
║  Port:     ${String(PORT).padEnd(33)}║
║  Products: ${String(products.length).padEnd(33)}║
║  AI Key:   ${(ANTHROPIC_KEY ? '✅ Configured' : '❌ Missing').padEnd(33)}║
║  Loja Key: ${(LOJA_API_KEY ? '✅ Configured' : '❌ Missing').padEnd(33)}║
╚══════════════════════════════════════════════╝
    `);
});
