import express from 'express'
import userRoute from './userRoute.js'

const router = express.Router()

// Health check
router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the API!' })
})

export default router

