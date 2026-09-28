import express from 'express'
import { signUp, signIn, refresh, signOut } from '../controller/auth.controller.js'

const router = express.Router()

router.post('/register', signUp)
router.post('/login', signIn)
router.post('/refresh', refresh)
router.post('/logout', signOut)

export default router
