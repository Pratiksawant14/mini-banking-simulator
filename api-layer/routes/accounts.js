const express = require('express');
const router = express.Router();
const {
  getAllAccounts,
  getAccountById,
  createAccount
} = require('../controllers/accountController');

// GET /accounts — list all accounts
router.get('/', getAllAccounts);

// GET /accounts/:account_id — get one account by account_id
router.get('/:account_id', getAccountById);

// POST /accounts — create a new account
router.post('/', createAccount);

module.exports = router;
