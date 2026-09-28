import express from 'express'
import {Resgister, 
        Login, 
        Refresh, 
        Logout, 
        resetPassword, 
        forgotPassword  
        } from "../controller/auth.controller"
        
const router = express.Router();

router.post = ("/resgister", Resgister );
router.post = ("/login", Login );
router.post = ("/refresh", Refresh );
router.post = ("/logout", Logout );
router.post = ("/reset-password", resetPassword );
router.post = ("/forgot-password", forgotPassword );


export default router;