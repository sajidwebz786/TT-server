const isErrorHandler = (handler) => handler.length === 4;

const wrapHandler = (handler) => {
  if (isErrorHandler(handler) || handler.__asyncWrapped) return handler;
  const wrapped = function asyncRouteWrapper(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === "function") {
        result.catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
  wrapped.__asyncWrapped = true;
  return wrapped;
};

export function wrapAsyncRoutes(router) {
  for (const layer of router.stack || []) {
    if (layer.route?.stack) {
      for (const routeLayer of layer.route.stack) {
        routeLayer.handle = wrapHandler(routeLayer.handle);
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      wrapAsyncRoutes(layer.handle);
    }
  }
  return router;
}

export function errorResponse(error, _req, res, _next) {
  console.error("API error:", error);
  if (res.headersSent) return;

  if (error.name === "SequelizeUniqueConstraintError") {
    const field = error.errors?.[0]?.path || "value";
    return res.status(409).json({ message: `${field} already exists. Please login or use a different ${field}.` });
  }

  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({ message: error.errors?.[0]?.message || "Please check the submitted details." });
  }

  if (error.name === "SequelizeDatabaseError") {
    return res.status(500).json({ message: "Database error. Please try again in a moment." });
  }

  const status = Number(error.status || error.statusCode) || 500;
  const safeMessage = status >= 500 ? "Something went wrong. Please try again in a moment." : error.message;
  res.status(status).json({ message: safeMessage });
}
