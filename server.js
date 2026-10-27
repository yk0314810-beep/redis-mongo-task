import dns from 'node:dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import express from 'express';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CACHE_KEY = 'products:all';
const CACHE_TTL = 60; // 60 seconds

// 1. MongoDB Schema banayein
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  stock: { type: Number, required: true }
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

// 2. 20 Sample Products list
const seedProducts = [
  { name: 'Wireless Mouse', price: 25.99, category: 'Electronics', stock: 120 },
  { name: 'Mechanical Keyboard', price: 79.99, category: 'Electronics', stock: 45 },
  { name: 'USB-C Cable', price: 9.99, category: 'Accessories', stock: 300 },
  { name: 'Gaming Monitor 27"', price: 299.99, category: 'Electronics', stock: 18 },
  { name: 'Noise-Canceling Headphones', price: 149.99, category: 'Audio', stock: 35 },
  { name: 'Desk Mat', price: 19.99, category: 'Accessories', stock: 80 },
  { name: 'Webcam 1080p', price: 49.99, category: 'Electronics', stock: 60 },
  { name: 'Laptop Stand', price: 34.50, category: 'Accessories', stock: 95 },
  { name: 'Bluetooth Speaker', price: 39.99, category: 'Audio', stock: 50 },
  { name: 'External SSD 1TB', price: 89.99, category: 'Storage', stock: 40 },
  { name: 'Ergonomic Chair', price: 220.00, category: 'Furniture', stock: 12 },
  { name: 'Standing Desk Converter', price: 175.00, category: 'Furniture', stock: 15 },
  { name: 'Microphone USB', price: 65.00, category: 'Audio', stock: 28 },
  { name: 'Screen Cleaning Kit', price: 7.99, category: 'Accessories', stock: 150 },
  { name: 'Smart Power Strip', price: 29.99, category: 'Electronics', stock: 70 },
  { name: 'Wireless Charger Pad', price: 18.50, category: 'Accessories', stock: 110 },
  { name: 'HDMI Cable 2.1', price: 12.99, category: 'Accessories', stock: 130 },
  { name: 'Wi-Fi 6 Router', price: 119.99, category: 'Networking', stock: 22 },
  { name: 'Graphic Tablet', price: 85.00, category: 'Electronics', stock: 33 },
  { name: 'Cable Management Clips', price: 5.99, category: 'Accessories', stock: 250 }
];

// 3. Redis Setup
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

redisClient.on('error', (err) => console.error('Redis Error:', err));

// 4. GET /products: Fetch Products with Caching
app.get('/products', async (req, res) => {
  try {
    const cachedData = await redisClient.get(CACHE_KEY);

    if (cachedData) {
      console.log('[SOURCE]: Served from Redis Cache');
      return res.status(200).json({
        source: 'Redis Cache',
        count: JSON.parse(cachedData).length,
        data: JSON.parse(cachedData)
      });
    }

    // Cache Miss -> MongoDB query
    console.log('[SOURCE]: Served from MongoDB (Compass database)');
    const products = await Product.find().lean();

    // Redis mein store karein (TTL 60s)
    await redisClient.set(CACHE_KEY, JSON.stringify(products), {
      EX: CACHE_TTL
    });

    return res.status(200).json({
      source: 'MongoDB (Primary Data Source)',
      count: products.length,
      data: products
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({ error: 'Server error fetching products' });
  }
});

// 5. POST /products: Add New Product & Invalidate Cache
app.post('/products', async (req, res) => {
  try {
    const { name, price, category, stock } = req.body;

    if (!name || price === undefined || !category || stock === undefined) {
      return res.status(400).json({
        error: 'name, price, category, aur stock fields required hain.'
      });
    }

    const newProduct = await Product.create({
      name,
      price: Number(price),
      category,
      stock: Number(stock)
    });

    console.log(`[DB]: Product added: "${newProduct.name}"`);

    // Invalidate Redis Cache
    await redisClient.del(CACHE_KEY);
    console.log(`[CACHE INVALIDATED]: Key "${CACHE_KEY}" delete ho gayi Redis se.`);

    return res.status(201).json({
      message: 'Product added successfully. Cache invalidated.',
      product: newProduct
    });
  } catch (error) {
    console.error('Error adding product:', error);
    return res.status(500).json({ error: 'Server error adding product' });
  }
});

// 6. Connect Database & Start Server
const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/product_db');
    console.log(' Connected to MongoDB (Compass connection: mongodb://127.0.0.1:27017)');

    // Seed 20 items if empty
    const count = await Product.countDocuments();
    if (count === 0) {
      await Product.insertMany(seedProducts);
      console.log(` Automatically seeded ${seedProducts.length} initial products into MongoDB.`);
    }

    await redisClient.connect();
    console.log(' Connected to Redis.');

    app.listen(PORT, () => {
      console.log(` Server is live at: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Initialization error:', err);
    process.exit(1);
  }
};

startServer();