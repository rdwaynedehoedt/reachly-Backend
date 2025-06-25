require("dotenv").config();

// Debug environment variables
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("CORS_ORIGIN:", process.env.CORS_ORIGIN);
console.log("CALLBACK_URL:", process.env.CALLBACK_URL);

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require("express-session");
var passport = require("passport");
var cors = require('cors');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var authRouter = require("./routes/auth");

var app = express();

// Enable CORS for frontend
const corsOrigins = [
  'http://localhost:3000',
  'https://reachly-frontend.vercel.app',
  'https://reachly-frontend-git-main-dwaynes-projects-941c4222.vercel.app',
  'https://reachly-frontend-c8kz5y8ay-dwaynes-projects-941c4222.vercel.app',
  // Add wildcard for development domains
  /^https:\/\/reachly-frontend-.*-dwaynes-projects-.*\.vercel\.app$/
];

console.log("CORS origins:", corsOrigins);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests)
    if (!origin) return callback(null, true);
    
    // Log all origin attempts for debugging
    console.log("Request origin:", origin);
    
    // Check if origin matches any of the allowed origins
    const isAllowed = corsOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin || origin === process.env.CORS_ORIGIN;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      console.log("CORS allowed for origin:", origin);
      callback(null, true);
    } else {
      console.log("CORS blocked for origin:", origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      domain: process.env.COOKIE_DOMAIN || undefined // Set this in production to your API domain
    }
  })
);
app.use(passport.authenticate("session"));

// API routes
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use("/auth", authRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
