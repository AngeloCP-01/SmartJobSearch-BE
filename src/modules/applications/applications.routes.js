const { Router } = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { validate } = require("../../shared/middleware/validate");
const {
  createApplicationSchema,
  updateApplicationSchema,
  statusSchema,
  listApplicationsQuerySchema,
  boardApplicationsQuerySchema,
} = require("./applications.schema");
const { linkContactSchema } = require("../contacts/contacts.schema");
const { linkDocumentSchema } = require("../documents/documents.schema");
const ctrl = require("./applications.controller");

// One route table, two list handlers. Duplicating the table for v2 instead
// would let the versions drift the first time either is edited.
function makeRouter(listHandler, { board = false } = {}) {
  const router = Router();
  router.use(requireAuth); // all routes require auth,if not, the request will be rejected before hitting the controller

  router.get("/", listHandler);
  // Register before /:id so "board" is never interpreted as an application id.
  if (board) {
    router.get("/board", validate(boardApplicationsQuerySchema, "query"), ctrl.board);
  }
  router.post("/", validate(createApplicationSchema), ctrl.create);
  router.get("/:id", ctrl.getById);
  router.patch("/:id", validate(updateApplicationSchema), ctrl.update);
  router.patch("/:id/status", validate(statusSchema), ctrl.updateStatus);
  router.delete("/:id", ctrl.remove);
  router.post("/:id/contacts", validate(linkContactSchema), ctrl.linkContact);
  router.delete("/:id/contacts/:contactId", ctrl.unlinkContact);
  router.post(
    "/:id/documents",
    validate(linkDocumentSchema),
    ctrl.linkDocument,
  );
  router.delete("/:id/documents/:documentId", ctrl.unlinkDocument);

  return router;
}

module.exports = {
  v1: makeRouter(ctrl.list),
  v2: makeRouter([
    validate(listApplicationsQuerySchema, "query"),
    ctrl.listPaged,
  ], { board: true }),
};
