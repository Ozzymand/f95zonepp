// ==UserScript==
// @name        F95Zone++
// @namespace   Violentmonkey Scripts
// @match       https://f95zone.to/*
// @grant       MIT
// @version     1.2
// @author      Ozzy
// @url         https://github.com/Ozzymand/f95zonepp
// @description Extremely rough draft of something bigger.
// ==/UserScript==

let URL_LATEST = "f95zone\.to\/sam\/latest_alpha";

// User-exposed variables
let BORDER_WIDTH = 2;

// Experimental
let DRAW_COMMUNITY_ENGAGEMENT_BORDER = true;

// Distributed weights [least -> most]
const LIKES_WEIGHT = 1.2;   // I've settled on 1.2, 1.8, 3.4
const VIEWS_WEIGHT = 1.8;   //  from my testing these offer a good
const RATING_WEIGHT = 3.4;  //  grading system on the games

// Dev stuff
let DEBUGGING = false;
let initalTime = null;
const multipliers = { 'K': 1e3, 'M': 1e6, 'B': 1e9 };
let gameCardsObserver = null;
let processedCards = new Set(); // Track which cards we've already processed

////////////////////////////////////////////////////////////////////////////////////////
// Logging utilities
const LogLevel = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    SUCCESS: 'SUCCESS',
    DEBUG: 'DEBUG'
};

const LogStyles = {
    INFO: 'color: #00bfff; font-weight: bold;',      // Cyan
    WARN: 'color: #ffa500; font-weight: bold;',      // Orange
    ERROR: 'color: #ff4444; font-weight: bold;',     // Red
    SUCCESS: 'color: #00ff00; font-weight: bold;',   // Green
    DEBUG: 'color: #9370db; font-weight: bold;',     // Purple
    RESET: 'color: inherit; font-weight: normal;',
    HIGHLIGHT: 'color: #ffff00; font-weight: bold;', // Yellow
    MUTED: 'color: #888888;'                         // Gray
};

function clog(level, message, ...params) {
    if (!DEBUGGING) return;
    
    const timestamp = new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 3
    });
    
    const prefix = `[F95++] [${timestamp}]`;
    const style = LogStyles[level];
    
    if (params.length > 0) {
        console.log(`%c${prefix} ${message}`, style, ...params);
    } else {
        console.log(`%c${prefix} ${message}`, style);
    }
}

function ilog(message, ...params) {
    clog(LogLevel.INFO, message, ...params);
}

function wlog(message, ...params) {
    clog(LogLevel.WARN, message, ...params);
}

function elog(message, ...params) {
    clog(LogLevel.ERROR, message, ...params);
}

function slog(message, ...params) {
    clog(LogLevel.SUCCESS, message, ...params);
}

function dlog(message, ...params) {
    clog(LogLevel.DEBUG, message, ...params);
}

function logPerformance(label, startTime) {
    if (!DEBUGGING) return;
    const duration = Date.now() - startTime;
    const style = duration < 100 ? LogStyles.SUCCESS : 
                  duration < 250 ? LogStyles.INFO : 
                  LogStyles.WARN;
    
    console.log(
        `%c[F95++] %c${label}%c took %c${duration}ms`,
        LogStyles.DEBUG,
        LogStyles.HIGHLIGHT,
        LogStyles.RESET,
        style
    );
}

function logTable(label, data) {
    if (!DEBUGGING) return;
    console.log(`%c[F95++] ${label}`, LogStyles.INFO);
    console.table(data);
}

function logGroup(label, callback) {
    if (!DEBUGGING) return;
    console.group(`%c[F95++] ${label}`, LogStyles.INFO);
    callback();
    console.groupEnd();
}

////////////////////////////////////////////////////////////////////////////////////////
// Handle page specific logic
onUrlChange();
if (self.navigation) {
    navigation.addEventListener('navigatesuccess', onUrlChange);
} else {
    let u = location.href;
    new MutationObserver(() => u !== (u = location.href) && onUrlChange())
        .observe(document, { subtree: true, childList: true });
}

function onUrlChange() {
    initalTime = Date.now();
    ilog("processing", location.href);

    // Disconnect previous observer if it exists
    if (gameCardsObserver) {
        gameCardsObserver.disconnect();
        gameCardsObserver = null;
    }

    // Clear processed cards when navigating
    processedCards.clear();

    if (location.pathname.includes('/latest_alpha')) {
        waitForGameCards();
        return;
    }
    ilog('Nothing special to do on current page');
}

////////////////////////////////////////////////////////////////////////////////////////
// Wait for game cards to be loaded
function waitForGameCards() {
    let container = document.getElementById("latest-page_items-wrap_inner");

    if (!container) {
        ilog("Container not found, waiting...");
        setTimeout(waitForGameCards, 100);
        return;
    }

    // Process any existing cards
    let game_cards = container.querySelectorAll('.resource-tile');
    if (game_cards.length > 0) {
        slog("Game cards already loaded");
        latest_updates();
    }

    // Set up continuous observer for new cards (for page navigation)
    ilog("Setting up observer for card changes...");
    gameCardsObserver = new MutationObserver((mutations) => {
        // Check if cards were added or removed
        let hasChanges = mutations.some(mutation =>
            mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
        );

        if (hasChanges) {
            ilog("Cards changed, reprocessing...");
            // Small delay to ensure all cards are loaded
            setTimeout(() => {
                latest_updates();
            }, 100);
        }
    });

    gameCardsObserver.observe(container, {
        childList: true,
        subtree: false // Only watch direct children
    });
}

////////////////////////////////////////////////////////////////////////////////////////
// Latest Updates logic
function latest_updates() {
    let container = document.getElementById("latest-page_items-wrap_inner");
    if (!container) {
        wlog("Container not found");
        return;
    }

    let game_cards = Array.from(container.querySelectorAll('.resource-tile'));

    slog(`Found ${game_cards.length} game cards`);

    if (game_cards.length === 0) {
        ilog("No game cards found, HTMLCollection:", container.children);
        return;
    }

    // Get unique identifier for each card (thread-id)
    let currentCardIds = new Set();
    game_cards.forEach(card => {
        let threadId = card.getAttribute('data-thread-id');
        if (threadId) {
            currentCardIds.add(threadId);
        }
    });

    // Check if this is a new set of cards
    let isNewPage = false;
    currentCardIds.forEach(id => {
        if (!processedCards.has(id)) {
            isNewPage = true;
        }
    });

    if (!isNewPage && processedCards.size > 0) {
        ilog("Same cards, skipping...");
        return;
    }

    // Clear old processed cards and add new ones
    processedCards.clear();
    currentCardIds.forEach(id => processedCards.add(id));

    let parsed_games = parse_games(game_cards);
    slog("Parsed games:", parsed_games);

    // Apply effects based on user preference
    parsed_games.forEach((game, index) => {
        weight_color_coding(game_cards[index], game);
    });
    logPerformance("Page processing", initalTime);
}

function parse_games(game_cards) {
    return game_cards.map(card => parse_game_metadata(card));
}

function calculate_average_rating(views, likes, rating, tags) {
    views = Number(views) || 0;
    likes = Number(likes) || 0;
    rating = Number(rating) || 0;

    let weighted_views = Math.log10(views + 1) * VIEWS_WEIGHT;
    let weighted_likes = Math.log10(likes + 1) * LIKES_WEIGHT;
    let weighted_rating = rating * RATING_WEIGHT;
    let weighted_tags = 0;

    let base_score = weighted_views + weighted_likes + weighted_rating;

    // Modifiers for overall rating
    // THESE VALUES ARE SO RANDOM, THEY NEED TWEAKING
    let modifiers = 0;

    ////
    // These valuse are curretly extremely linearly calculated
    ////

    // 1. Engagement Bonus (Likes per View)
    // If more than 5% of viewers liked it, it's a "Fan Favorite"
    let like_ratio = views > 0 ? (likes / views) : 0;
    if (like_ratio > 0.05) modifiers += 3;
    if (like_ratio > 0.10) modifiers += 2; // Stackable +5 total for high engagement

    // 2. The "Clickbait" Penalty
    // High views but very low rating (under 3.0) drops the score significantly
    if (views > 20000 && rating < 3.0) modifiers -= 5;

    // 3. The "Masterpiece" Bonus
    // If a game has a near-perfect rating and at least some likes
    if (rating >= 4.5 && likes > 50) modifiers += 2;

    let total_score = base_score + modifiers;

    return {
        total: total_score.toFixed(2),
        breakdown: {
            views: weighted_views.toFixed(2),
            likes: weighted_likes.toFixed(2),
            rating: weighted_rating.toFixed(2)
        },
        probability: calculate_weighted_probability(total_score)
    };
}

function calculate_weighted_probability(score) {
    if (score >= 27) return 4; // High   community engagement
    if (score >= 25) return 3; // Medium community engagement
    if (score >= 15) return 2; // Low    community engagement
    if (score >= 9) return 1;  // Bad    community engagement
    return 0; // Game is too new
}

function parse_game_metadata(game_card) {
    // Extract title
    let title_element = game_card.querySelector('.resource-tile_info-header_title');
    let title = title_element ? title_element.textContent.trim() : 'N/A';

    // Extract thread ID (useful for tracking)
    let threadId = game_card.getAttribute('data-thread-id');

    // Extract tags (from data-tags attribute)
    let tags_string = game_card.getAttribute('data-tags') || '';
    let tags = tags_string ? tags_string.split(',').map(tag => parseInt(tag.trim())) : [];

    // Extract views
    let views_element = game_card.querySelector('.resource-tile_info-meta_views');
    let views = views_element ? views_element.textContent.trim() : 0;
    // Normalize views if shortened
    let _suffix = views.slice(-1).toUpperCase();
    let normalized_views = parseFloat(views) * (multipliers[_suffix] || 1);

    // Extract likes
    let likes_element = game_card.querySelector('.resource-tile_info-meta_likes');
    let likes = likes_element ? parseInt(likes_element.textContent.trim()) : 0;

    // Extract rating
    let rating_element = game_card.querySelector('.resource-tile_info-meta_rating');
    let rating = rating_element ? parseFloat(rating_element.textContent.trim()) : null;

    let wAverage = calculate_average_rating(normalized_views, likes, rating, tags);
    // wAverage breakdown:
    //  - total: int
    //  - breakdown: array
    //      - views: int
    //      - likes: int
    //      - rating: int
    //  - probability: int
    return {
        threadId: threadId,
        title: title,
        tags: tags,
        views: normalized_views,
        likes: likes,
        rating: rating,
        weighted_average: wAverage
    };
}

function weight_color_coding(card_element, game_data) {
    // Remove any existing styling first
    if (!DRAW_COMMUNITY_ENGAGEMENT_BORDER) {
        return;
    }

    let probability = game_data.weighted_average.probability;

    if (probability === 4) {
        card_element.style.borderLeft = `${BORDER_WIDTH}px solid #00ff00ff`;
    } else if (probability === 3) {
        card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ffff00`;
    } else if (probability === 2) {
        card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ff9900ff`;
    } else if (probability === 1) {
        card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ff0400ff`;
    } else {
        card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ff000042`;
    }
}