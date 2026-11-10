import express from "express";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { codeEntryIpLimiter } from "../middlewares/rateLimit.js";
import {
    acceptInvite, acceptLink, cancelLinkCode, childGames, childOverview, childReport, createLinkCode,
    getFamily, inspectInvite, removeLink, requestLink, sendInvite, updateChild,
} from "../controller/family.controller.js";

const router = express.Router();
// Xem trước lời mời không cần đăng nhập: trang lời mời hiện ai đã mời trước khi bảo người nhận đăng nhập
router.post("/invites/inspect", codeEntryIpLimiter, inspectInvite);
router.use(protectedRoute);
router.get("/", getFamily);
router.post("/link-code", createLinkCode);
router.delete("/link-code", cancelLinkCode);
router.post("/links", codeEntryIpLimiter, requestLink);
router.post("/links/:linkId/accept", acceptLink);
router.delete("/links/:linkId", removeLink);
router.post("/invites", sendInvite);
router.post("/invites/accept", acceptInvite);
router.get("/children/:childId/overview", childOverview);
router.get("/children/:childId/report", childReport);
router.get("/children/:childId/games", childGames);
router.patch("/children/:childId", updateChild);
export default router;
