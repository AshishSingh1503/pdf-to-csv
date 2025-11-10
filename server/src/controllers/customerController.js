// server/src/controllers/customerController.js
import { Customer } from '../models/Customer.js';
import logger from '../utils/logger.js';
import cache from '../services/cache.js';

const { KEYS } = cache;

// Get all customers
export const getAllCustomers = async (req, res) => {
  try {
  const customers = await cache.getOrSet(KEYS.CUSTOMERS_ALL, async () => Customer.findAll());
    res.json({ success: true, data: customers });
  } catch (error) {
    logger.error('Error fetching customers', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to fetch customers' });
  }
};

// Get customer by ID
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
  const customer = await cache.getOrSet(KEYS.CUSTOMER_BY_ID(id), async () => Customer.findById(id));
    
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    
    res.json({ success: true, data: customer });
  } catch (error) {
    logger.error('Error fetching customer', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to fetch customer' });
  }
};

// Create new customer
export const createCustomer = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Customer name is required' });
    }
    
    const customer = await Customer.create({
      name: name.trim(),
      email: email?.trim(),
      phone: phone?.trim()
    });
    // invalidate customer list cache
  cache.del(KEYS.CUSTOMERS_ALL);
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    logger.error('Error creating customer', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to create customer' });
  }
};

// Update customer
export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;
    
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Customer name is required' });
    }
    
    const updatedCustomer = await customer.update({
      name: name.trim(),
      email: email?.trim(),
      phone: phone?.trim()
    });
    
    if (!updatedCustomer) {
      return res.status(500).json({ success: false, error: 'Failed to update customer' });
    }
    
  cache.del(KEYS.CUSTOMERS_ALL);
  cache.del(KEYS.CUSTOMER_BY_ID(id));
    res.json({ success: true, data: updatedCustomer });
  } catch (error) {
    logger.error('Error updating customer', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to update customer' });
  }
};

// Delete customer
export const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    
    const deleted = await customer.delete();
    if (!deleted) {
      return res.status(500).json({ success: false, error: 'Failed to delete customer' });
    }
    cache.del(KEYS.CUSTOMERS_ALL);
    cache.del(KEYS.CUSTOMER_BY_ID(id));
    // Invalidate collections cache for this customer and global collections list
    try {
      cache.del(KEYS.COLLECTIONS_ALL(id));
      cache.del(KEYS.COLLECTIONS_ALL_GLOBAL);
    } catch (e) {
      // fallback: use pattern invalidation
      cache.invalidatePattern(`collections:all:${id}`);
      cache.invalidatePattern(KEYS.COLLECTIONS_ALL_GLOBAL);
    }
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    logger.error('Error deleting customer', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to delete customer' });
  }
};
