// ==UserScript==
// @name        F95Zone++
// @namespace   Violentmonkey Scripts
// @match       https://f95zone.to/*
// @grant       MIT
// @version     1.1
// @author      Me
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
const multipliers = { 'K': 1e3, 'M': 1e6, 'B': 1e9 };
let gameCardsObserver = null;
let processedCards = new Set(); // Track which cards we've already processed

function clog(msg, ...param) {
    if (DEBUGGING) {
        console.log(msg, ...param);
    }
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
    clog("processing", location.href);

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
    clog('Nothing special to do on current page');
}

////////////////////////////////////////////////////////////////////////////////////////
// Wait for game cards to be loaded
function waitForGameCards() {
    let container = document.getElementById("latest-page_items-wrap_inner");

    if (!container) {
        clog("Container not found, waiting...");
        setTimeout(waitForGameCards, 100);
        return;
    }

    // Process any existing cards
    let game_cards = container.querySelectorAll('.resource-tile');
    if (game_cards.length > 0) {
        clog("Game cards already loaded");
        latest_updates();
    }

    // Set up continuous observer for new cards (for page navigation)
    clog("Setting up observer for card changes...");
    gameCardsObserver = new MutationObserver((mutations) => {
        // Check if cards were added or removed
        let hasChanges = mutations.some(mutation =>
            mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
        );

        if (hasChanges) {
            clog("Cards changed, reprocessing...");
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
        clog("Container not found");
        return;
    }

    let game_cards = Array.from(container.querySelectorAll('.resource-tile'));

    clog(`Found ${game_cards.length} game cards`);

    if (game_cards.length === 0) {
        clog("No game cards found, HTMLCollection:", container.children);
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
        clog("Same cards, skipping...");
        return;
    }

    // Clear old processed cards and add new ones
    processedCards.clear();
    currentCardIds.forEach(id => processedCards.add(id));

    let parsed_games = parse_games(game_cards);
    clog("Parsed games:", parsed_games);

    // Apply effects based on user preference
    parsed_games.forEach((game, index) => {
        weight_color_coding(game_cards[index], game);
    });
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
    if(!DRAW_COMMUNITY_ENGAGEMENT_BORDER){
        return;
    }
    card_element.style.borderLeft = "";

    if (game_data.weighted_average.probability !== null) {
        if (game_data.weighted_average.probability === 4) {
            card_element.style.borderLeft = `${BORDER_WIDTH}px solid #00ff00ff`; // Green for high rating
        } else if (game_data.weighted_average.probability === 3) {
            card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ffff00`; // Yellow for medium rating
        } else if (game_data.weighted_average.probability === 2) {
            card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ff9900ff`; // Yellow for medium rating
        } else if (game_data.weighted_average.probability === 1) {
            card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ff0400ff`; // Yellow for medium rating
        } else {
            card_element.style.borderLeft = `${BORDER_WIDTH}px solid #ff000042`; // Red for low rating
        }
    }
}