import express from 'express'
import cookieParser from 'cookie-parser'
import { connectDB } from '../lib/db.js'
import { env } from '../config/environment.js';
import { errorHandlingMiddleware } from './middlewares/errorHandlingMiddleware.js'
import apiRoutes from './routes/api.js'

const START_SERVER = () => {
  const app = express()

  // Core middlewares
  app.use(cors(corsOptions))
  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: true, limit: '100kb' }))
  app.use(cookieParser())

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  app.use('/api', apiRoutes)
  app.use(errorHandlingMiddleware)

  app.listen(env.PORT, () => {
    console.log(`🚀 Server is running on port ${env.PORT} [${env.BUILD_MODE}]`)
  })
}; 

(async () => {
    try {
      await connectDB()
      START_SERVER()
    } catch (error) {
      console.error('❌ Failed to start server:', error)
      process.exit(1)
    }
  })()
