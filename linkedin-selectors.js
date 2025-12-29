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
    SKILLS: {
        SECTION: '#skills',
        ITEMS: 'ul > li.artdeco-list__item',
        SKILL_NAME: '.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]',
        ENDORSEMENT_COUNT: '.t-14.t-black--light span[aria-hidden="true"]'
    },
    LANGUAGES: {
        SECTION: '#languages',
        ITEMS: 'ul > li.artdeco-list__item',
        LANGUAGE_NAME: '.t-bold span[aria-hidden="true"]',
        PROFICIENCY: '.t-14 span[aria-hidden="true"]'
    },
    CERTIFICATIONS: {
        SECTION: '#licenses_and_certifications',
        ITEMS: 'ul > li.artdeco-list__item',
        CERT_NAME: '.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]',
        ISSUER: '.t-14.t-normal span[aria-hidden="true"]'
    },
    VOLUNTEER: {
        SECTION: '#volunteering_experience',
        ITEMS: 'ul > li.artdeco-list__item',
        ROLE: '.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]',
        ORGANIZATION: '.t-14.t-normal span[aria-hidden="true"]'
    },
    AWARDS: {
        SECTION: '#honors_and_awards',
        ITEMS: 'ul > li.artdeco-list__item',
        AWARD_NAME: '.t-bold span[aria-hidden="true"]',
        ISSUER: '.t-14 span[aria-hidden="true"]'
    },
    PROJECTS: {
        SECTION: '#projects',
        ITEMS: 'ul > li.artdeco-list__item',
        PROJECT_NAME: '.t-bold span[aria-hidden="true"]',
        DESCRIPTION: '.t-14 span[aria-hidden="true"]'
    },
    PUBLICATIONS: {
        SECTION: '#publications',
        ITEMS: 'ul > li.artdeco-list__item',
        TITLE: '.t-bold span[aria-hidden="true"]',
        PUBLISHER: '.t-14 span[aria-hidden="true"]'
    },
    COURSES: {
        SECTION: '#courses',
        ITEMS: 'ul > li.artdeco-list__item',
        COURSE_NAME: '.t-bold span[aria-hidden="true"]',
        NUMBER: '.t-14 span[aria-hidden="true"]'
    },
    TEST_SCORES: {
        SECTION: '#test_scores',
        ITEMS: 'ul > li.artdeco-list__item',
        TEST_NAME: '.t-bold span[aria-hidden="true"]',
        SCORE: '.t-14 span[aria-hidden="true"]'
    },
    PATENTS: {
        SECTION: '#patents',
        ITEMS: 'ul > li.artdeco-list__item',
        PATENT_NAME: '.t-bold span[aria-hidden="true"]',
        DETAILS: '.t-14 span[aria-hidden="true"]'
    },
    ORGANIZATIONS: {
        SECTION: '#organizations',
        ITEMS: 'ul > li.artdeco-list__item',
        ORG_NAME: '.t-bold span[aria-hidden="true"]',
        POSITION: '.t-14 span[aria-hidden="true"]'
    },
    RECOMMENDATIONS: {
        SECTION: '#recommendations',
        ITEMS: 'ul > li.artdeco-list__item',
        RECOMMENDER: '.t-bold span[aria-hidden="true"]',
        TEXT: '.inline-show-more-text span[aria-hidden="true"]'
    },
    FEATURED: {
        SECTION: '#featured',
        ITEMS: 'ul > li.artdeco-list__item',
        TITLE: '.t-bold span[aria-hidden="true"]',
        DESCRIPTION: '.t-14 span[aria-hidden="true"]'
    },
    INTERESTS: {
        SECTION: '#interests',
        ITEMS: 'ul > li.artdeco-list__item',
        INTEREST_NAME: '.t-bold span[aria-hidden="true"]'
    },
    PROFILE_HEADER: {
        CONNECTIONS: '.pv-top-card--list li:first-child span',
        FOLLOWERS: '.pv-top-card--list-bullet li',
        PROFILE_PHOTO: '.pv-top-card-profile-picture__image',
        CONTACT_INFO_BUTTON: '#top-card-text-details-contact-info'
    },
    CONTACT_INFO: {
        EMAIL: 'section.pv-contact-info__contact-type.ci-email a[href^="mailto:"]',
        PHONE: 'section.pv-contact-info__contact-type.ci-phone span.t-14',
        WEBSITE: 'section.pv-contact-info__contact-type.ci-websites a',
        TWITTER: 'section.pv-contact-info__contact-type.ci-twitter a',
        BIRTHDAY: 'section.pv-contact-info__contact-type.ci-birthday span.t-14',
        ADDRESS: 'section.pv-contact-info__contact-type.ci-address a'
    },
    ACTIVITY: {
        SECTION: '.pv-recent-activity-section',
        POSTS: '.occludable-update',
        POST_TEXT: '.feed-shared-text span[dir="ltr"]'
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
