// server/src/controllers/customerController.js
import { Customer } from '../models/Customer.js';

// Get all customers
export const getAllCustomers = async (req, res) => {
  try {
    const customers = await Customer.findAll();
    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch customers' });
  }
};

// Get customer by ID
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id);
    
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    
    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Error fetching customer:', error);
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
    
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    console.error('Error creating customer:', error);
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
    
    res.json({ success: true, data: updatedCustomer });
  } catch (error) {
    console.error('Error updating customer:', error);
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
    
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ success: false, error: 'Failed to delete customer' });
  }
};
