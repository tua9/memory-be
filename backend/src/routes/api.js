import express from 'express'

const router = express.Router()

// Health check
router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the API!' })
})

export default router

