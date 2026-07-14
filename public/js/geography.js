(function () {
    'use strict';

    const ROUND_LENGTH = 10;
    const STORAGE_KEY = 'rendler.geography.v1';
    const REGIONS = ['All', 'Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

    const MODES = {
        flag_country: {
            title: 'Flag → Country',
            icon: '🇯🇵',
            description: 'Look at a big flag and name the country.',
            prompt: 'What country is this?',
            supportsTyped: true,
            supportsRegion: true,
            answerKind: 'country'
        },
        country_capital: {
            title: 'Country → Capital',
            icon: '🇨🇦',
            description: 'See the country and flag, then name the capital city.',
            prompt: 'What is the capital city?',
            supportsTyped: true,
            supportsRegion: true,
            answerKind: 'capital'
        },
        capital_country: {
            title: 'Capital → Country',
            icon: '🏛️',
            description: 'Match a capital city back to its country.',
            prompt: 'Which country has this capital?',
            supportsTyped: true,
            supportsRegion: true,
            answerKind: 'country'
        },
        country_flag: {
            title: 'Country → Flag',
            icon: '🇧🇷',
            description: 'Choose the correct oversized flag for the country.',
            prompt: 'Which flag belongs to this country?',
            supportsTyped: false,
            supportsRegion: true,
            answerKind: 'flag'
        },
        region_challenge: {
            title: 'Region Challenge',
            icon: '🧭',
            description: 'Place each country in the right world region.',
            prompt: 'Which region is this country in?',
            supportsTyped: false,
            supportsRegion: false,
            answerKind: 'region'
        }
    };

    const COUNTRIES = [
        c('AF','Afghanistan','Kabul','Asia'),
        c('AL','Albania','Tirana','Europe'),
        c('DZ','Algeria','Algiers','Africa'),
        c('AD','Andorra','Andorra la Vella','Europe'),
        c('AO','Angola','Luanda','Africa'),
        c('AG','Antigua and Barbuda',"St. John's",'Americas'),
        c('AR','Argentina','Buenos Aires','Americas'),
        c('AM','Armenia','Yerevan','Asia'),
        c('AU','Australia','Canberra','Oceania'),
        c('AT','Austria','Vienna','Europe'),
        c('AZ','Azerbaijan','Baku','Asia'),
        c('BS','Bahamas','Nassau','Americas',['The Bahamas']),
        c('BH','Bahrain','Manama','Asia'),
        c('BD','Bangladesh','Dhaka','Asia'),
        c('BB','Barbados','Bridgetown','Americas'),
        c('BY','Belarus','Minsk','Europe'),
        c('BE','Belgium','Brussels','Europe'),
        c('BZ','Belize','Belmopan','Americas'),
        c('BJ','Benin','Porto-Novo','Africa',[],['Cotonou']),
        c('BT','Bhutan','Thimphu','Asia'),
        c('BO','Bolivia','Sucre','Americas',['Bolivia (Plurinational State of)'],['La Paz']),
        c('BA','Bosnia and Herzegovina','Sarajevo','Europe',['Bosnia']),
        c('BW','Botswana','Gaborone','Africa'),
        c('BR','Brazil','Brasília','Americas',[],['Brasilia']),
        c('BN','Brunei','Bandar Seri Begawan','Asia',['Brunei Darussalam']),
        c('BG','Bulgaria','Sofia','Europe'),
        c('BF','Burkina Faso','Ouagadougou','Africa'),
        c('BI','Burundi','Gitega','Africa'),
        c('CV','Cabo Verde','Praia','Africa',['Cape Verde']),
        c('KH','Cambodia','Phnom Penh','Asia'),
        c('CM','Cameroon','Yaoundé','Africa',[],['Yaounde']),
        c('CA','Canada','Ottawa','Americas'),
        c('CF','Central African Republic','Bangui','Africa'),
        c('TD','Chad',"N'Djamena",'Africa',['Tchad'],['NDjamena']),
        c('CL','Chile','Santiago','Americas'),
        c('CN','China','Beijing','Asia'),
        c('CO','Colombia','Bogotá','Americas',[],['Bogota']),
        c('KM','Comoros','Moroni','Africa'),
        c('CG','Congo','Brazzaville','Africa',['Republic of the Congo']),
        c('CR','Costa Rica','San José','Americas',[],['San Jose']),
        c('CI',"Côte d'Ivoire",'Yamoussoukro','Africa',['Ivory Coast','Cote d Ivoire'],['Abidjan']),
        c('HR','Croatia','Zagreb','Europe'),
        c('CU','Cuba','Havana','Americas'),
        c('CY','Cyprus','Nicosia','Europe'),
        c('CZ','Czechia','Prague','Europe',['Czech Republic']),
        c('CD','Democratic Republic of the Congo','Kinshasa','Africa',['DR Congo','DRC','Congo-Kinshasa']),
        c('DK','Denmark','Copenhagen','Europe'),
        c('DJ','Djibouti','Djibouti','Africa'),
        c('DM','Dominica','Roseau','Americas'),
        c('DO','Dominican Republic','Santo Domingo','Americas'),
        c('EC','Ecuador','Quito','Americas'),
        c('EG','Egypt','Cairo','Africa'),
        c('SV','El Salvador','San Salvador','Americas'),
        c('GQ','Equatorial Guinea','Malabo','Africa'),
        c('ER','Eritrea','Asmara','Africa'),
        c('EE','Estonia','Tallinn','Europe'),
        c('SZ','Eswatini','Mbabane','Africa',['Swaziland'],['Lobamba']),
        c('ET','Ethiopia','Addis Ababa','Africa'),
        c('FJ','Fiji','Suva','Oceania'),
        c('FI','Finland','Helsinki','Europe'),
        c('FR','France','Paris','Europe'),
        c('GA','Gabon','Libreville','Africa'),
        c('GM','Gambia','Banjul','Africa',['The Gambia']),
        c('GE','Georgia','Tbilisi','Asia'),
        c('DE','Germany','Berlin','Europe'),
        c('GH','Ghana','Accra','Africa'),
        c('GR','Greece','Athens','Europe'),
        c('GD','Grenada',"St. George's",'Americas',['Grenada'],['Saint George\'s']),
        c('GT','Guatemala','Guatemala City','Americas'),
        c('GN','Guinea','Conakry','Africa'),
        c('GW','Guinea-Bissau','Bissau','Africa'),
        c('GY','Guyana','Georgetown','Americas'),
        c('HT','Haiti','Port-au-Prince','Americas'),
        c('HN','Honduras','Tegucigalpa','Americas'),
        c('HU','Hungary','Budapest','Europe'),
        c('IS','Iceland','Reykjavik','Europe',['Iceland'],['Reykjavík']),
        c('IN','India','New Delhi','Asia'),
        c('ID','Indonesia','Jakarta','Asia'),
        c('IR','Iran','Tehran','Asia',['Iran (Islamic Republic of)']),
        c('IQ','Iraq','Baghdad','Asia'),
        c('IE','Ireland','Dublin','Europe'),
        c('IL','Israel','Jerusalem','Asia'),
        c('IT','Italy','Rome','Europe'),
        c('JM','Jamaica','Kingston','Americas'),
        c('JP','Japan','Tokyo','Asia'),
        c('JO','Jordan','Amman','Asia'),
        c('KZ','Kazakhstan','Astana','Asia'),
        c('KE','Kenya','Nairobi','Africa'),
        c('KI','Kiribati','South Tarawa','Oceania'),
        c('KW','Kuwait','Kuwait City','Asia'),
        c('KG','Kyrgyzstan','Bishkek','Asia'),
        c('LA','Laos','Vientiane','Asia',['Lao PDR','Lao People\'s Democratic Republic']),
        c('LV','Latvia','Riga','Europe'),
        c('LB','Lebanon','Beirut','Asia'),
        c('LS','Lesotho','Maseru','Africa'),
        c('LR','Liberia','Monrovia','Africa'),
        c('LY','Libya','Tripoli','Africa'),
        c('LI','Liechtenstein','Vaduz','Europe'),
        c('LT','Lithuania','Vilnius','Europe'),
        c('LU','Luxembourg','Luxembourg','Europe',['Luxembourg City']),
        c('MG','Madagascar','Antananarivo','Africa'),
        c('MW','Malawi','Lilongwe','Africa'),
        c('MY','Malaysia','Kuala Lumpur','Asia',[],['Putrajaya']),
        c('MV','Maldives','Malé','Asia',[],['Male']),
        c('ML','Mali','Bamako','Africa'),
        c('MT','Malta','Valletta','Europe'),
        c('MH','Marshall Islands','Majuro','Oceania'),
        c('MR','Mauritania','Nouakchott','Africa'),
        c('MU','Mauritius','Port Louis','Africa'),
        c('MX','Mexico','Mexico City','Americas'),
        c('FM','Micronesia','Palikir','Oceania',['Federated States of Micronesia']),
        c('MD','Moldova','Chișinău','Europe',['Moldova (Republic of)'],['Chisinau']),
        c('MC','Monaco','Monaco','Europe'),
        c('MN','Mongolia','Ulaanbaatar','Asia'),
        c('ME','Montenegro','Podgorica','Europe'),
        c('MA','Morocco','Rabat','Africa'),
        c('MZ','Mozambique','Maputo','Africa'),
        c('MM','Myanmar','Naypyidaw','Asia',['Burma'],['Nay Pyi Taw','Naypyitaw']),
        c('NA','Namibia','Windhoek','Africa'),
        c('NR','Nauru','Yaren','Oceania'),
        c('NP','Nepal','Kathmandu','Asia'),
        c('NL','Netherlands','Amsterdam','Europe',['The Netherlands']),
        c('NZ','New Zealand','Wellington','Oceania'),
        c('NI','Nicaragua','Managua','Americas'),
        c('NE','Niger','Niamey','Africa'),
        c('NG','Nigeria','Abuja','Africa'),
        c('KP','North Korea','Pyongyang','Asia',['DPRK','Korea (Democratic People\'s Republic of)']),
        c('MK','North Macedonia','Skopje','Europe',['Macedonia']),
        c('NO','Norway','Oslo','Europe'),
        c('OM','Oman','Muscat','Asia'),
        c('PK','Pakistan','Islamabad','Asia'),
        c('PW','Palau','Ngerulmud','Oceania'),
        c('PS','Palestine','Ramallah','Asia',['State of Palestine','Palestinian Territory'],['East Jerusalem']),
        c('PA','Panama','Panama City','Americas'),
        c('PG','Papua New Guinea','Port Moresby','Oceania'),
        c('PY','Paraguay','Asunción','Americas',[],['Asuncion']),
        c('PE','Peru','Lima','Americas'),
        c('PH','Philippines','Manila','Asia'),
        c('PL','Poland','Warsaw','Europe'),
        c('PT','Portugal','Lisbon','Europe'),
        c('QA','Qatar','Doha','Asia'),
        c('RO','Romania','Bucharest','Europe'),
        c('RU','Russia','Moscow','Europe',['Russian Federation']),
        c('RW','Rwanda','Kigali','Africa'),
        c('KN','Saint Kitts and Nevis','Basseterre','Americas',['St Kitts and Nevis']),
        c('LC','Saint Lucia','Castries','Americas',['St Lucia']),
        c('VC','Saint Vincent and the Grenadines','Kingstown','Americas',['St Vincent and the Grenadines']),
        c('WS','Samoa','Apia','Oceania'),
        c('SM','San Marino','San Marino','Europe'),
        c('ST','Sao Tome and Principe','São Tomé','Africa',['São Tomé and Príncipe'],['Sao Tome']),
        c('SA','Saudi Arabia','Riyadh','Asia'),
        c('SN','Senegal','Dakar','Africa'),
        c('RS','Serbia','Belgrade','Europe'),
        c('SC','Seychelles','Victoria','Africa'),
        c('SL','Sierra Leone','Freetown','Africa'),
        c('SG','Singapore','Singapore','Asia'),
        c('SK','Slovakia','Bratislava','Europe'),
        c('SI','Slovenia','Ljubljana','Europe'),
        c('SB','Solomon Islands','Honiara','Oceania'),
        c('SO','Somalia','Mogadishu','Africa'),
        c('ZA','South Africa','Pretoria','Africa',[],['Cape Town','Bloemfontein']),
        c('KR','South Korea','Seoul','Asia',['Republic of Korea','Korea']),
        c('SS','South Sudan','Juba','Africa'),
        c('ES','Spain','Madrid','Europe'),
        c('LK','Sri Lanka','Sri Jayawardenepura Kotte','Asia',[],['Colombo','Kotte']),
        c('SD','Sudan','Khartoum','Africa'),
        c('SR','Suriname','Paramaribo','Americas'),
        c('SE','Sweden','Stockholm','Europe'),
        c('CH','Switzerland','Bern','Europe',['Swiss Confederation']),
        c('SY','Syria','Damascus','Asia',['Syrian Arab Republic']),
        c('TJ','Tajikistan','Dushanbe','Asia'),
        c('TZ','Tanzania','Dodoma','Africa',['United Republic of Tanzania']),
        c('TH','Thailand','Bangkok','Asia'),
        c('TL','Timor-Leste','Dili','Asia',['East Timor']),
        c('TG','Togo','Lomé','Africa',[],['Lome']),
        c('TO','Tonga',"Nuku'alofa",'Oceania'),
        c('TT','Trinidad and Tobago','Port of Spain','Americas'),
        c('TN','Tunisia','Tunis','Africa'),
        c('TR','Turkey','Ankara','Asia',['Türkiye','Turkiye']),
        c('TM','Turkmenistan','Ashgabat','Asia'),
        c('TV','Tuvalu','Funafuti','Oceania'),
        c('UG','Uganda','Kampala','Africa'),
        c('UA','Ukraine','Kyiv','Europe',['Ukraine'],['Kiev']),
        c('AE','United Arab Emirates','Abu Dhabi','Asia',['UAE']),
        c('GB-ENG','England','London','Europe',[],[], '🏴󠁧󠁢󠁥󠁮󠁧󠁿'),
        c('GB-SCT','Scotland','Edinburgh','Europe',['Alba'],[], '🏴󠁧󠁢󠁳󠁣󠁴󠁿'),
        c('GB-WLS','Wales','Cardiff','Europe',['Cymru'],[], '🏴󠁧󠁢󠁷󠁬󠁳󠁿'),
        c('GB-NIR','Northern Ireland','Belfast','Europe',['N. Ireland','N Ireland'],[], '🇬🇧'),
        c('US','United States','Washington, D.C.','Americas',['USA','United States of America','US'],['Washington DC','Washington']),
        c('UY','Uruguay','Montevideo','Americas'),
        c('UZ','Uzbekistan','Tashkent','Asia'),
        c('VU','Vanuatu','Port Vila','Oceania'),
        c('VA','Vatican City','Vatican City','Europe',['Holy See']),
        c('VE','Venezuela','Caracas','Americas',['Venezuela (Bolivarian Republic of)']),
        c('VN','Vietnam','Hanoi','Asia',['Viet Nam']),
        c('YE','Yemen',"Sana'a",'Asia',['Yemen'],['Sanaa','Sana’a']),
        c('ZM','Zambia','Lusaka','Africa'),
        c('ZW','Zimbabwe','Harare','Africa')
    ];

    const state = {
        currentMode: 'flag_country',
        currentAnswerStyle: 'choice',
        currentRegion: 'All',
        reviewMissed: false,
        questions: [],
        questionIndex: 0,
        score: 0,
        currentStreak: 0,
        bestRoundStreak: 0,
        answered: false,
        roundMisses: []
    };

    let storage = loadStorage();
    let refs = {};

    document.addEventListener('DOMContentLoaded', init);

    /**
     * Creates a country data object.
     *
     * @param {string} code - Stable quiz identifier.
     * @param {string} name - Common country name.
     * @param {string} capital - Capital city name.
     * @param {string} region - World region.
     * @param {string[]} [aliases] - Alternate country names.
     * @param {string[]} [capitalAliases] - Alternate capital names.
     * @param {string} [flag] - Custom flag text for entries without a two-letter country emoji.
     * @returns {Object} Country data record.
     */
    function c(code, name, capital, region, aliases, capitalAliases, flag) {
        return {
            code,
            name,
            capital,
            region,
            aliases: aliases || [],
            capitalAliases: capitalAliases || [],
            flag: flag || null
        };
    }

    /**
     * Initialises the quiz UI and binds event listeners.
     *
     * @returns {void}
     */
    function init() {
        refs = {
            startView: document.getElementById('geo-start-view'),
            quizView: document.getElementById('geo-quiz-view'),
            resultsView: document.getElementById('geo-results-view'),
            modeGrid: document.getElementById('geo-mode-grid'),
            overallStats: document.getElementById('geo-overall-stats'),
            homeBtn: document.getElementById('geo-home-btn'),
            modeLabel: document.getElementById('geo-mode-label'),
            questionCount: document.getElementById('geo-question-count'),
            scorePill: document.getElementById('geo-score-pill'),
            progressFill: document.getElementById('geo-progress-fill'),
            promptKicker: document.getElementById('geo-prompt-kicker'),
            promptFlag: document.getElementById('geo-prompt-flag'),
            promptText: document.getElementById('geo-prompt-text'),
            answerArea: document.getElementById('geo-answer-area'),
            feedback: document.getElementById('geo-feedback'),
            nextBtn: document.getElementById('geo-next-btn'),
            finalScore: document.getElementById('geo-final-score'),
            resultMessage: document.getElementById('geo-result-message'),
            missedList: document.getElementById('geo-missed-list'),
            playAgainBtn: document.getElementById('geo-play-again-btn'),
            reviewBtn: document.getElementById('geo-review-btn'),
            chooseModeBtn: document.getElementById('geo-choose-mode-btn'),
            resetBtn: document.getElementById('geo-reset-btn')
        };

        refs.homeBtn?.addEventListener('click', showStart);
        refs.nextBtn?.addEventListener('click', nextQuestion);
        refs.playAgainBtn?.addEventListener('click', () => startRound(state.currentMode, state.currentAnswerStyle, state.currentRegion, false));
        refs.reviewBtn?.addEventListener('click', () => startRound(state.currentMode, state.currentAnswerStyle, state.currentRegion, true));
        refs.chooseModeBtn?.addEventListener('click', showStart);
        refs.resetBtn?.addEventListener('click', resetStats);

        renderModeCards();
        showStart();
    }

    /**
     * Reads persisted quiz stats from localStorage.
     *
     * @returns {Object} Stored stats object with fallback.
     */
    function loadStorage() {
        const fallback = { modes: {} };
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            return parsed && typeof parsed === 'object' ? { modes: {}, ...parsed } : fallback;
        } catch (err) {
            return fallback;
        }
    }

    /**
     * Writes current quiz stats to localStorage.
     *
     * @returns {void}
     */
    function saveStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
        } catch (err) {
            // The quiz still works without persistence.
        }
    }

    /**
     * Returns the stats object for a given mode, initialising if absent.
     *
     * @param {string} modeKey - Mode identifier from MODES.
     * @returns {Object} Mode stats record.
     */
    function modeStats(modeKey) {
        if (!storage.modes) storage.modes = {};
        if (!storage.modes[modeKey]) {
            storage.modes[modeKey] = {
                bestScore: 0,
                bestStreak: 0,
                lastRegion: 'All',
                lastAnswerStyle: 'choice',
                missed: []
            };
        }
        return storage.modes[modeKey];
    }

    /**
     * Renders the mode selection card grid with stats and controls.
     *
     * @returns {void}
     */
    function renderModeCards() {
        if (!refs.modeGrid) return;
        refs.modeGrid.innerHTML = Object.entries(MODES).map(([key, mode]) => {
            const stats = modeStats(key);
            const answerChips = mode.supportsTyped ? `
                <div class="geo-chip-row" role="group" aria-label="${window.escapeHtml(mode.title)} answer style">
                    ${chipButton(key, 'answer', 'choice', 'Multiple Choice', stats.lastAnswerStyle !== 'typed')}
                    ${chipButton(key, 'answer', 'typed', 'Typed', stats.lastAnswerStyle === 'typed')}
                </div>
            ` : '<div class="geo-mode-meta"><span>Multiple choice only</span></div>';
            const regionChips = mode.supportsRegion ? `
                <div class="geo-chip-row" role="group" aria-label="${window.escapeHtml(mode.title)} region">
                    ${REGIONS.map(region => chipButton(key, 'region', region, region, (stats.lastRegion || 'All') === region)).join('')}
                </div>
            ` : '<div class="geo-mode-meta"><span>All countries</span><span>No region filter</span></div>';

            return `
                <article class="geo-mode-card glass-panel" data-mode="${key}">
                    <div class="geo-mode-card-top">
                        <div class="geo-mode-icon" aria-hidden="true">${mode.icon}</div>
                        <div>
                            <h3>${mode.title}</h3>
                            <p>${mode.description}</p>
                        </div>
                    </div>
                    <div class="geo-mode-meta">
                        <span>Best ${stats.bestScore || 0}/${ROUND_LENGTH}</span>
                        <span>Streak ${stats.bestStreak || 0}</span>
                        <span>Missed ${(stats.missed || []).length}</span>
                    </div>
                    <div class="geo-mode-actions">
                        ${answerChips}
                        ${regionChips}
                        <button type="button" class="btn-primary geo-start-mode" data-mode="${key}">Start</button>
                    </div>
                </article>
            `;
        }).join('');

        refs.modeGrid.querySelectorAll('.geo-chip').forEach(button => {
            button.addEventListener('click', handleChipClick);
        });
        refs.modeGrid.querySelectorAll('.geo-start-mode').forEach(button => {
            button.addEventListener('click', () => {
                const modeKey = button.dataset.mode;
                const stats = modeStats(modeKey);
                startRound(modeKey, stats.lastAnswerStyle || 'choice', stats.lastRegion || 'All', false);
            });
        });
        renderOverallStats();
    }

    /**
     * Generates a chip button HTML string for mode configuration.
     *
     * @param {string} modeKey - Mode identifier.
     * @param {string} type - Chip type (answer or region).
     * @param {string} value - Chip value.
     * @param {string} label - Display label.
     * @param {boolean} active - Whether the chip is active.
     * @returns {string} Chip button markup.
     */
    function chipButton(modeKey, type, value, label, active) {
        return `
            <button type="button"
                class="geo-chip${active ? ' active' : ''}"
                data-mode="${modeKey}"
                data-chip-type="${type}"
                data-value="${window.escapeHtml(value)}">
                ${window.escapeHtml(label)}
            </button>
        `;
    }

    /**
     * Handles chip button clicks to update mode preferences.
     *
     * @param {Event} event - Click event.
     * @returns {void}
     */
    function handleChipClick(event) {
        const button = event.currentTarget;
        const modeKey = button.dataset.mode;
        const type = button.dataset.chipType;
        const value = button.dataset.value;
        const stats = modeStats(modeKey);

        if (type === 'answer') {
            stats.lastAnswerStyle = value;
        } else if (type === 'region') {
            stats.lastRegion = value;
        }
        saveStorage();
        renderModeCards();
    }

    /**
     * Updates the overall best score display.
     *
     * @returns {void}
     */
    function renderOverallStats() {
        const best = Object.keys(MODES).reduce((max, key) => Math.max(max, modeStats(key).bestScore || 0), 0);
        if (refs.overallStats) refs.overallStats.textContent = `Best: ${best}/${ROUND_LENGTH}`;
    }

    /**
     * Starts a new quiz round with the given configuration.
     *
     * @param {string} modeKey - Mode identifier.
     * @param {string} answerStyle - Answer style (choice or typed).
     * @param {string} region - Region filter.
     * @param {boolean} reviewMissed - Whether to review missed countries only.
     * @returns {void}
     */
    function startRound(modeKey, answerStyle, region, reviewMissed) {
        const mode = MODES[modeKey];
        if (!mode) return;

        const stats = modeStats(modeKey);
        const style = mode.supportsTyped && answerStyle === 'typed' ? 'typed' : 'choice';
        const selectedRegion = mode.supportsRegion ? (region || 'All') : 'All';
        const pool = getQuestionPool(modeKey, selectedRegion, reviewMissed);

        if (pool.length < 4 && style === 'choice') {
            showToastMessage('Not enough countries in that pool yet. Try All countries.');
            return;
        }
        if (pool.length < 1) {
            showToastMessage('No missed countries to review for this mode yet.');
            return;
        }

        stats.lastAnswerStyle = style;
        stats.lastRegion = selectedRegion;
        saveStorage();

        state.currentMode = modeKey;
        state.currentAnswerStyle = style;
        state.currentRegion = selectedRegion;
        state.reviewMissed = reviewMissed;
        state.questions = shuffle(pool).slice(0, Math.min(ROUND_LENGTH, pool.length));
        state.questionIndex = 0;
        state.score = 0;
        state.currentStreak = 0;
        state.bestRoundStreak = 0;
        state.answered = false;
        state.roundMisses = [];

        showView('quiz');
        renderQuestion();
    }

    /**
     * Builds a filtered question pool from the country list.
     *
     * @param {string} modeKey - Mode identifier.
     * @param {string} region - Region filter.
     * @param {boolean} reviewMissed - Whether to filter to missed countries.
     * @returns {Object[]} Array of country objects.
     */
    function getQuestionPool(modeKey, region, reviewMissed) {
        const stats = modeStats(modeKey);
        let pool = COUNTRIES.slice();
        if (MODES[modeKey].supportsRegion && region !== 'All') {
            pool = pool.filter(country => country.region === region);
        }
        if (reviewMissed) {
            const missed = new Set(stats.missed || []);
            pool = pool.filter(country => missed.has(country.code));
        }
        return pool;
    }

    /**
     * Renders the current question into the quiz view.
     *
     * @returns {void}
     */
    function renderQuestion() {
        const country = state.questions[state.questionIndex];
        const mode = MODES[state.currentMode];
        state.answered = false;

        refs.modeLabel.textContent = mode.title;
        refs.questionCount.textContent = `Question ${state.questionIndex + 1} / ${state.questions.length}`;
        refs.scorePill.textContent = `Score ${state.score}`;
        refs.progressFill.style.width = `${(state.questionIndex / state.questions.length) * 100}%`;
        refs.promptKicker.textContent = mode.prompt;
        refs.promptFlag.textContent = promptFlag(mode, country);
        refs.promptText.textContent = promptText(mode, country);
        refs.feedback.className = 'geo-feedback glass-panel hidden';
        refs.feedback.innerHTML = '';
        refs.nextBtn.disabled = true;

        if (state.currentAnswerStyle === 'typed') {
            renderTypedAnswer(country);
        } else {
            renderChoiceAnswers(country);
        }
    }

    /**
     * Returns the flag emoji for the prompt when applicable.
     *
     * @param {Object} mode - Mode configuration.
     * @param {Object} country - Current country data.
     * @returns {string} Flag emoji or empty string.
     */
    function promptFlag(mode, country) {
        if (state.currentMode === 'flag_country' || state.currentMode === 'country_capital' || state.currentMode === 'region_challenge') {
            return displayFlag(country);
        }
        return '';
    }

    /**
     * Returns the question prompt text for the current mode.
     *
     * @param {Object} mode - Mode configuration.
     * @param {Object} country - Current country data.
     * @returns {string} Prompt text.
     */
    function promptText(mode, country) {
        if (state.currentMode === 'flag_country') return 'Name this country';
        if (state.currentMode === 'country_capital') return country.name;
        if (state.currentMode === 'capital_country') return country.capital;
        if (state.currentMode === 'country_flag') return country.name;
        if (state.currentMode === 'region_challenge') return country.name;
        return mode.prompt;
    }

    /**
     * Renders multiple-choice answer buttons.
     *
     * @param {Object} country - Current country data.
     * @returns {void}
     */
    function renderChoiceAnswers(country) {
        const options = buildOptions(country);
        refs.answerArea.innerHTML = `
            <div class="geo-answer-grid">
                ${options.map(option => `
                    <button type="button"
                        class="geo-answer-card${state.currentMode === 'country_flag' ? ' geo-flag-option' : ''}"
                        data-code="${window.escapeHtml(option.code)}"
                        data-value="${window.escapeHtml(option.value)}">
                        ${window.escapeHtml(option.label)}
                    </button>
                `).join('')}
            </div>
        `;
        refs.answerArea.querySelectorAll('.geo-answer-card').forEach(button => {
            button.addEventListener('click', () => chooseAnswer(button, country));
        });
    }

    /**
     * Builds shuffled answer options including the correct one.
     *
     * @param {Object} country - Current country data.
     * @returns {Object[]} Array of option objects with code, value, label.
     */
    function buildOptions(country) {
        if (state.currentMode === 'region_challenge') {
            return shuffle(REGIONS.filter(region => region !== 'All')).map(region => ({
                code: region,
                value: region,
                label: region
            }));
        }

        const pool = getQuestionPool(state.currentMode, state.currentRegion, false);
        const wrong = shuffle(pool.filter(item => {
            if (item.code === country.code) return false;
            if (state.currentMode === 'flag_country' || state.currentMode === 'country_flag') {
                return displayFlag(item) !== displayFlag(country);
            }
            return true;
        })).slice(0, 3);
        return shuffle([country, ...wrong]).map(item => ({
            code: item.code,
            value: answerValue(item),
            label: optionLabel(item)
        }));
    }

    /**
     * Returns the display label for a country in answer options.
     *
     * @param {Object} country - Country data.
     * @returns {string} Display label.
     */
    function optionLabel(country) {
        if (state.currentMode === 'country_capital') return country.capital;
        if (state.currentMode === 'country_flag') return displayFlag(country);
        return country.name;
    }

    /**
     * Returns the correct answer value for a country in the current mode.
     *
     * @param {Object} country - Country data.
     * @returns {string} Correct answer value.
     */
    function answerValue(country) {
        if (state.currentMode === 'country_capital') return country.capital;
        if (state.currentMode === 'country_flag') return country.code;
        if (state.currentMode === 'region_challenge') return country.region;
        return country.name;
    }

    /**
     * Renders a typed answer input form.
     *
     * @param {Object} country - Current country data.
     * @returns {void}
     */
    function renderTypedAnswer(country) {
        refs.answerArea.innerHTML = `
            <form id="geo-typed-form" class="geo-typed-card">
                <input id="geo-typed-input" class="game-input" type="text" autocomplete="off" placeholder="Type your answer..." required>
                <button type="submit" class="btn-primary">Check Answer</button>
            </form>
        `;
        const form = document.getElementById('geo-typed-form');
        const input = document.getElementById('geo-typed-input');
        form?.addEventListener('submit', event => {
            event.preventDefault();
            checkTypedAnswer(input.value, country);
        });
        input?.focus();
    }

    /**
     * Handles a multiple-choice answer selection.
     *
     * @param {HTMLElement} button - Clicked answer button.
     * @param {Object} country - Current country data.
     * @returns {void}
     */
    function chooseAnswer(button, country) {
        if (state.answered) return;
        const correctValue = answerValue(country);
        const selectedValue = button.dataset.value || button.dataset.code || '';
        const correct = normalize(selectedValue) === normalize(correctValue);
        finishAnswer(correct, country);

        refs.answerArea.querySelectorAll('.geo-answer-card').forEach(option => {
            option.disabled = true;
            if (normalize(option.dataset.value || '') === normalize(correctValue)) {
                option.classList.add('correct');
            } else if (option === button && !correct) {
                option.classList.add('incorrect');
            }
        });
    }

    /**
     * Validates a typed answer against accepted values.
     *
     * @param {string} rawValue - User-typed input.
     * @param {Object} country - Current country data.
     * @returns {void}
     */
    function checkTypedAnswer(rawValue, country) {
        if (state.answered) return;
        const accepted = acceptedAnswers(country).map(normalize);
        const correct = accepted.includes(normalize(rawValue));
        finishAnswer(correct, country);
        const input = document.getElementById('geo-typed-input');
        const button = refs.answerArea.querySelector('button');
        if (input) input.disabled = true;
        if (button) button.disabled = true;
    }

    /**
     * Returns all accepted answer strings for a country in the current mode.
     *
     * @param {Object} country - Country data.
     * @returns {string[]} Accepted answers.
     */
    function acceptedAnswers(country) {
        if (state.currentMode === 'country_capital') {
            return [country.capital, ...country.capitalAliases];
        }
        return [country.name, country.code, ...country.aliases];
    }

    /**
     * Records an answer result and updates score and streak.
     *
     * @param {boolean} correct - Whether the answer was correct.
     * @param {Object} country - Current country data.
     * @returns {void}
     */
    function finishAnswer(correct, country) {
        state.answered = true;
        refs.nextBtn.disabled = false;
        if (correct) {
            state.score += 1;
            state.currentStreak += 1;
            state.bestRoundStreak = Math.max(state.bestRoundStreak, state.currentStreak);
        } else {
            state.currentStreak = 0;
            state.roundMisses.push(country.code);
        }
        refs.scorePill.textContent = `Score ${state.score}`;
        renderFeedback(correct, country);
    }

    /**
     * Shows answer feedback in the quiz view.
     *
     * @param {boolean} correct - Whether the answer was correct.
     * @param {Object} country - Current country data.
     * @returns {void}
     */
    function renderFeedback(correct, country) {
        refs.feedback.className = `geo-feedback glass-panel ${correct ? 'correct' : 'incorrect'}`;
        refs.feedback.innerHTML = `
            <p class="geo-feedback-title">${correct ? 'Correct!' : 'Not quite.'}</p>
            <p class="geo-feedback-detail">${feedbackDetail(country)}</p>
        `;
    }

    /**
     * Returns the feedback detail string for a country.
     *
     * @param {Object} country - Country data.
     * @returns {string} Feedback text with flag, name, capital, and region.
     */
    function feedbackDetail(country) {
        if (state.currentMode === 'country_capital') {
            return `${displayFlag(country)} ${country.name} → ${country.capital}`;
        }
        if (state.currentMode === 'region_challenge') {
            return `${displayFlag(country)} ${country.name} is in ${country.region}.`;
        }
        return `${displayFlag(country)} ${country.name} → ${country.capital}`;
    }

    /**
     * Advances to the next question or finishes the round.
     *
     * @returns {void}
     */
    function nextQuestion() {
        if (!state.answered) return;
        if (state.questionIndex + 1 >= state.questions.length) {
            finishRound();
            return;
        }
        state.questionIndex += 1;
        renderQuestion();
    }

    /**
     * Completes the current round and persists stats.
     *
     * @returns {void}
     */
    function finishRound() {
        const stats = modeStats(state.currentMode);
        const missedSet = new Set([...(stats.missed || []), ...state.roundMisses]);
        state.questions.forEach(country => {
            if (!state.roundMisses.includes(country.code)) missedSet.delete(country.code);
        });
        stats.missed = Array.from(missedSet);
        stats.bestScore = Math.max(stats.bestScore || 0, state.score);
        stats.bestStreak = Math.max(stats.bestStreak || 0, state.bestRoundStreak);
        saveStorage();
        renderResults();
    }

    /**
     * Renders the final score and missed items in the results view.
     *
     * @returns {void}
     */
    function renderResults() {
        const total = state.questions.length;
        refs.finalScore.textContent = `${state.score}/${total}`;
        refs.resultMessage.textContent = resultMessage(state.score, total);

        const missedCountries = state.roundMisses.map(code => COUNTRIES.find(country => country.code === code)).filter(Boolean);
        refs.missedList.innerHTML = missedCountries.length
            ? `<h3>Missed this round</h3>${missedCountries.map(country => `
                <div class="geo-missed-item">${displayFlag(country)} ${window.escapeHtml(country.name)} → ${window.escapeHtml(country.capital)} · ${window.escapeHtml(country.region)}</div>
            `).join('')}`
            : '<div class="geo-missed-item">Perfect round. Nothing to review.</div>';

        refs.reviewBtn.disabled = missedCountries.length === 0 && (modeStats(state.currentMode).missed || []).length === 0;
        renderModeCards();
        showView('results');
    }

    /**
     * Returns an encouraging message based on the final score.
     *
     * @param {number} score - Questions answered correctly.
     * @param {number} total - Total questions in the round.
     * @returns {string} Result message.
     */
    function resultMessage(score, total) {
        const pct = total ? score / total : 0;
        if (pct === 1) return 'Perfect round. Tiny globe genius energy.';
        if (pct >= 0.8) return 'Great work. A few more runs and this mode is yours.';
        if (pct >= 0.5) return 'Solid start. Review the misses and go again.';
        return 'The map is warming up. Try a focused region or review missed.';
    }

    /**
     * Resets all persisted quiz stats.
     *
     * @returns {void}
     */
    function resetStats() {
        storage = { modes: {} };
        saveStorage();
        renderModeCards();
        showStart();
    }

    /**
     * Shows the start view with mode selection.
     *
     * @returns {void}
     */
    function showStart() {
        renderModeCards();
        showView('start');
    }

    /**
     * Toggles visibility between start, quiz, and results views.
     *
     * @param {string} view - View name (start, quiz, results).
     * @returns {void}
     */
    function showView(view) {
        refs.startView?.classList.toggle('hidden', view !== 'start');
        refs.quizView?.classList.toggle('hidden', view !== 'quiz');
        refs.resultsView?.classList.toggle('hidden', view !== 'results');
        refs.homeBtn?.classList.toggle('hidden', view === 'start');
    }

    /**
     * Fisher-Yates shuffle of an array copy.
     *
     * @param {Array} items - Array to shuffle.
     * @returns {Array} New shuffled array.
     */
    function shuffle(items) {
        const copy = items.slice();
        for (let i = copy.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    /**
     * Returns the display flag for a quiz record.
     *
     * Custom entries such as UK constituent countries do not always have a standard
     * two-letter country emoji, so they carry an explicit display value.
     *
     * @param {Object} country - Country data record.
     * @returns {string} Flag display text.
     */
    function displayFlag(country) {
        return country.flag || flagEmoji(country.code);
    }

    /**
     * Converts an ISO country code to a flag emoji.
     *
     * @param {string} code - Two-letter country code.
     * @returns {string} Flag emoji.
     */
    function flagEmoji(code) {
        if (!/^[A-Za-z]{2}$/.test(code)) return '🏳️';
        return code
            .toUpperCase()
            .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
    }

    /**
     * Normalises a string for case-insensitive comparison.
     *
     * @param {string} value - Raw string.
     * @returns {string} Normalised lowercase string without diacritics or punctuation.
     */
    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9]+/g, '')
            .trim();
    }

    /**
     * Shows a toast notification or falls back to alert.
     *
     * @param {string} message - Message to display.
     * @returns {void}
     */
    function showToastMessage(message) {
        if (typeof showToast === 'function') {
            showToast(message, 'info');
            return;
        }
        alert(message);
    }
}());
