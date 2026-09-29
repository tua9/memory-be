import express from 'express'
import authRoute from "./authRoute.js"

const router = express.Router()

// Health check
router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the API!' })
})

router.use("/auth", authRoute);

export default router

