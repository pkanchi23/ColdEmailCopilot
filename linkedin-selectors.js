// LinkedIn profile selectors
// Centralized location for all selectors - update here when LinkedIn changes their DOM
const LINKEDIN_SELECTORS = {
    PROFILE: {
        NAME: 'h1',
        HEADLINE: '.text-body-medium.break-words',
        LOCATION: [
            '.text-body-small.inline.t-black--light.break-words',
            '.pv-text-details__left-panel span.text-body-small',
            '.pb2.pv-text-details__left-panel span'
        ],
        ABOUT_SECTION: '#about',
        ABOUT_TEXT_COLLAPSED: '.inline-show-more-text--is-collapsed'
    },
    EXPERIENCE: {
        SECTION: '#experience',
        ITEMS: 'ul > li.artdeco-list__item',
        ROLE: '.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]',
        COMPANY: '.t-14.t-normal span[aria-hidden="true"]',
        DURATION: '.t-14.t-normal.t-black--light span[aria-hidden="true"]'
    },
    EDUCATION: {
        SECTION: '#education',
        ITEMS: 'ul > li.artdeco-list__item',
        SCHOOL: '.t-bold span[aria-hidden="true"]',
        DEGREE: '.t-14 span[aria-hidden="true"]'
    },
    BUTTONS: {
        ACTION_BAR: [
            '.pvs-profile-actions',
            '.ph5 .display-flex',
            '.pv-top-card-v2-ctas',
            '.pv-top-card__ctas'
        ],
        MESSAGE: 'button' // Will filter by text content
    },
    USER: {
        ME_PHOTO: '.global-nav__me-photo'
    }
};
