/* /public/js/emoji-picker.js */

const EmojiPicker = {
    activeInput: null,
    pickerElement: null,
    triggerBtn: null,
    
    // Massive expanded emoji set (~1000+ emojis)
    emojis: {
        'smileys': [
            {c:'😀',n:'smile'},{c:'😃',n:'grin'},{c:'😄',n:'laugh'},{c:'😁',n:'beams'},{c:'😆',n:'squint'},
            {c:'😅',n:'sweat'},{c:'🤣',n:'rofl'},{c:'😂',n:'joy'},{c:'🙂',n:'slight'},{c:'🙃',n:'upside'},
            {c:'😉',n:'wink'},{c:'😊',n:'blush'},{c:'😇',n:'halo'},{c:'🥰',n:'hearts'},{c:'😍',n:'heart-eyes'},
            {c:'🤩',n:'star-struck'},{c:'😘',n:'kiss'},{c:'😗',n:'kissing'},{c:'😚',n:'kissing-closed'},{c:'😋',n:'yum'},
            {c:'😛',n:'tongue'},{c:'😜',n:'wink-tongue'},{c:'🤪',n:'zany'},{c:'😝',n:'squint-tongue'},{c:'🤑',n:'money-mouth'},
            {c:'🤗',n:'hugs'},{c:'🤭',n:'hand-over-mouth'},{c:'🤫',n:'shush'},{c:'🤔',n:'thinking'},{c:'🤐',n:'zipper'},
            {c:'🤨',n:'eyebrow'},{c:'😐',n:'neutral'},{c:'😑',n:'expressionless'},{c:'😶',n:'no-mouth'},{c:'😏',n:'smirk'},
            {c:'😒',n:'unamused'},{c:'🙄',n:'roll-eyes'},{c:'😬',n:'grimace'},{c:'🤥',n:'liar'},{c:'😌',n:'relieved'},
            {c:'😔',n:'pensive'},{c:'😪',n:'sleepy'},{c:'🤤',n:'drool'},{c:'😴',n:'sleeping'},{c:'😷',n:'mask'},
            {c:'🤒',n:'thermometer'},{c:'🤕',n:'bandage'},{c:'🤢',n:'nauseated'},{c:'🤮',n:'vomit'},{c:'🤧',n:'sneeze'},
            {c:'🥵',n:'hot'},{c:'🥶',n:'cold'},{c:'🥴',n:'woozy'},{c:'😵',n:'dizzy'},{c:'🤯',n:'exploding'},
            {c:'🤠',n:'cowboy'},{c:'🥳',n:'partying'},{c:'😎',n:'cool'},{c:'🤓',n:'nerd'},{c:'🧐',n:'monocle'},
            {c:'😕',n:'confused'},{c:'😟',n:'worried'},{c:'🙁',n:'slight-frown'},{c:'☹️',n:'frown'},{c:'😮',n:'open-mouth'},
            {c:'😯',n:'hushed'},{c:'😲',n:'astonished'},{c:'😳',n:'flushed'},{c:'🥺',n:'pleading'},{c:'😧',n:'anguished'},
            {c:'😨',n:'fearful'},{c:'😰',n:'cold-sweat'},{c:'😥',n:'sad-relieved'},{c:'😢',n:'crying'},{c:'😭',n:'loud-crying'},
            {c:'😱',n:'scream'},{c:'😖',n:'confounded'},{c:'😣',n:'persevering'},{c:'😞',n:'disappointed'},{c:'😓',n:'sweat'},
            {c:'😩',n:'weary'},{c:'😫',n:'tired'},{c:'🥱',n:'yawning'},{c:'😤',n:'triumph'},{c:'😡',n:'pouting'},
            {c:'😠',n:'angry'},{c:'🤬',n:'symbols'},{c:'😈',n:'smiling-imp'},{c:'👿',n:'imp'},{c:'💀',n:'skull'},
            {c:'☠️',n:'skull-crossbones'},{c:'💩',n:'poop'},{c:'🤡',n:'clown'},{c:'👹',n:'ogre'},{c:'👺',n:'goblin'},
            {c:'👻',n:'ghost'},{c:'👽',n:'alien'},{c:'👾',n:'monster'},{c:'🤖',n:'robot'},{c:'😺',n:'cat'},
            {c:'😸',n:'grin-cat'},{c:'😹',n:'joy-cat'},{c:'😻',n:'heart-cat'},{c:'😼',n:'smirk-cat'},{c:'😽',n:'kiss-cat'},
            {c:'🙀',n:'weary-cat'},{c:'😿',n:'crying-cat'},{c:'😾',n:'pout-cat'},{c:'🙈',n:'see-no-evil'},{c:'🙉',n:'hear-no-evil'},
            {c:'🙊',n:'speak-no-evil'},{c:'💋',n:'kiss-mark'},{c:'💌',n:'love-letter'},{c:'💘',n:'cupid'},{c:'💝',n:'heart-ribbon'},
            {c:'💖',n:'sparkling-heart'},{c:'💗',n:'growing-heart'},{c:'💓',n:'beating-heart'},{c:'💞',n:'revolving-hearts'},{c:'💕',n:'two-hearts'},
            {c:'💟',n:'heart-decoration'},{c:'❣️',n:'heart-exclamation'},{c:'💔',n:'broken-heart'},{c:'❤️',n:'heart'},{c:'🧡',n:'orange-heart'},
            {c:'💛',n:'yellow-heart'},{c:'💚',n:'green-heart'},{c:'💙',n:'blue-heart'},{c:'💜',n:'purple-heart'},{c:'🖤',n:'black-heart'},
            {c:'🤍',n:'white-heart'},{c:'🤎',n:'brown-heart'}
        ],
        'people': [
            {c:'👋',n:'wave'},{c:'🤚',n:'back-hand'},{c:'🖐',n:'hand-fingers'},{c:'✋',n:'hand'},{c:'🖖',n:'vulcan'},
            {c:'👌',n:'ok'},{c:'🤌',n:'pinched'},{c:'🤏',n:'pinching'},{c:'✌️',n:'peace'},{c:'🤞',n:'crossed'},
            {c:'🤟',n:'love-you'},{c:'🤘',n:'rock-on'},{c:'🤙',n:'call-me'},{c:'👈',n:'left'},{c:'👉',n:'right'},
            {c:'👆',n:'up'},{c:'🖕',n:'middle-finger'},{c:'👇',n:'down'},{c:'☝️',n:'point-up'},{c:'👍',n:'thumbs-up'},
            {c:'👎',n:'thumbs-down'},{c:'✊',n:'fist'},{c:'👊',n:'punch'},{c:'🤛',n:'left-fist'},{c:'🤜',n:'right-fist'},
            {c:'👏',n:'clap'},{c:'🙌',n:'raising-hands'},{c:'👐',n:'open-hands'},{c:'🤲',n:'palms-up'},{c:'🤝',n:'shake'},
            {c:'🙏',n:'pray'},{c:'✍️',n:'writing'},{c:'💅',n:'nail-polish'},{c:'🤳',n:'selfie'},{c:'💪',n:'flex'},
            {c:'🦾',n:'robot-arm'},{c:'🦵',n:'leg'},{c:'🦿',n:'robot-leg'},{c:'🦶',n:'foot'},{c:'👂',n:'ear'},
            {c:'🦻',n:'hearing-aid'},{c:'👃',n:'nose'},{c:'🧠',n:'brain'},{c:'🫀',n:'heart'},{c:'🫁',n:'lungs'},
            {c:'🦷',n:'tooth'},{c:'🦴',n:'bone'},{c:'👀',n:'eyes'},{c:'👁',n:'eye'},{c:'👅',n:'tongue'},
            {c:'👄',n:'mouth'},{c:'👶',n:'baby'},{c:'🧒',n:'child'},{c:'👦',n:'boy'},{c:'👧',n:'girl'},
            {c:'🧑',n:'person'},{c:'👱',n:'blonde'},{c:'👨',n:'man'},{c:'🧔',n:'beard'},{c:'👩',n:'woman'},
            {c:'🧓',n:'older-person'},{c:'👴',n:'older-man'},{c:'👵',n:'older-woman'},{c:'🙍',n:'frown'},{c:'🙎',n:'pout'},
            {c:'🙅',n:'no'},{c:'🙆',n:'ok'},{c:'💁',n:'tipping-hand'},{c:'🙋',n:'raising-hand'},{c:'🧏',n:'deaf'},
            {c:'🙇',n:'bow'},{c:'🤦',n:'facepalm'},{c:'🤷',n:'shrug'},{c:'👮',n:'police'},{c:'🕵️',n:'detective'},
            {c:'💂',n:'guard'},{c:'🥷',n:'ninja'},{c:'👷',n:'construction'},{c:'🤴',n:'prince'},{c:'👸',n:'princess'},
            {c:'👳',n:'turban'},{c:'👲',n:'chinese-cap'},{c:'🧕',n:'headscarf'},{c:'🤵',n:'tuxedo'},{c:'👰',n:'bride'},
            {c:'🤰',n:'pregnant'},{c:'🤱',n:'breastfeeding'},{c:'👩‍🍳',n:'cook'},{c:'👨‍🍳',n:'cook'},{c:'👩‍🎓',n:'student'},
            {c:'👨‍🎓',n:'student'},{c:'👩‍🎤',n:'singer'},{c:'👨‍🎤',n:'singer'},{c:'👩‍🏫',n:'teacher'},{c:'👨‍🏫',n:'teacher'},
            {c:'👩‍💻',n:'coder'},{c:'👨‍💻',n:'coder'},{c:'👩‍💼',n:'office'},{c:'👨‍💼',n:'office'},{c:'👩‍🔧',n:'mechanic'},
            {c:'👨‍🔧',n:'mechanic'},{c:'👩‍🔬',n:'scientist'},{c:'👨‍🔬',n:'scientist'},{c:'👩‍🎨',n:'artist'},{c:'👨‍🎨',n:'artist'},
            {c:'👩‍🚒',n:'firefighter'},{c:'👨‍🚒',n:'firefighter'},{c:'👩‍✈️',n:'pilot'},{c:'👨‍✈️',n:'pilot'},{c:'👩‍🚀',n:'astronaut'},
            {c:'👨‍🚀',n:'astronaut'},{c:'👩‍⚖️',n:'judge'},{c:'👨‍⚖️',n:'judge'},{c:'👰‍♀️',n:'bride'},{c:'👰‍♂️',n:'groom'},
            {c:'🤵‍♀️',n:'tuxedo'},{c:'🤵‍♂️',n:'tuxedo'},{c:'👼',n:'angel'},{c:'🎅',n:'santa'},{c:'🤶',n:'mrs-claus'},
            {c:'🦸',n:'superhero'},{c:'🦹',n:'supervillain'},{c:'🧙',n:'mage'},{c:'🧚',n:'fairy'},{c:'🧛',n:'vampire'},
            {c:'🧜',n:'merperson'},{c:'🧝',n:'elf'},{c:'🧞',n:'genie'},{c:'🧟',n:'zombie'},{c:'💆',n:'massage'},
            {c:'💇',n:'haircut'},{c:'🚶',n:'walking'},{c:'🧍',n:'standing'},{c:'🧎',n:'kneeling'},{c:'🏃',n:'running'},
            {c:'💃',n:'dancing'},{c:'🕺',n:'dancing'},{c:'👯',n:'partying'},{c:'🧖',n:'sauna'},{c:'🧗',n:'climbing'}
        ],
        'animals': [
            {c:'🐶',n:'dog'},{c:'🐱',n:'cat'},{c:'🐭',n:'mouse'},{c:'Hamster',n:'hamster'},{c:'🐰',n:'rabbit'},
            {c:'🦊',n:'fox'},{c:'🐻',n:'bear'},{c:'🐼',n:'panda'},{c:'🐻‍❄️',n:'polar-bear'},{c:'🐨',n:'koala'},
            {c:'🐯',n:'tiger'},{c:'🦁',n:'lion'},{c:'🐮',n:'cow'},{c:'🐷',n:'pig'},{c:'🐸',n:'frog'},
            {c:'🐵',n:'monkey'},{c:'🐔',n:'chicken'},{c:'🐧',n:'penguin'},{c:'🐦',n:'bird'},{c:'🐤',n:'chick'},
            {c:'🦆',n:'duck'},{c:'🦅',n:'eagle'},{c:'🦉',n:'owl'},{c:'🦇',n:'bat'},{c:'🐺',n:'wolf'},
            {c:'🐗',n:'boar'},{c:'🐴',n:'horse'},{c:'🦄',n:'unicorn'},{c:'🐝',n:'bee'},{c:'🐛',n:'bug'},
            {c:'🦋',n:'butterfly'},{c:'🐌',n:'snail'},{c:'🐞',n:'lady-beetle'},{c:'🐜',n:'ant'},{c:'🦟',n:'mosquito'},
            {c:'🐢',n:'turtle'},{c:'🐍',n:'snake'},{c:'🦎',n:'lizard'},{c:'🦖',n:'t-rex'},{c:'🦕',n:'sauropod'},
            {c:'🐙',n:'octopus'},{c:'🦑',n:'squid'},{c:'🦐',n:'shrimp'},{c:'🦞',n:'lobster'},{c:'🦀',n:'crab'},
            {c:'🐡',n:'pufferfish'},{c:'🐠',n:'tropical-fish'},{c:'🐟',n:'fish'},{c:'🐬',n:'dolphin'},{c:'🐳',n:'whale'},
            {c:'🐋',n:'whale'},{c:'🦈',n:'shark'},{c:'🐊',n:'crocodile'},{c:'🐅',n:'tiger'},{c:'🐆',n:'leopard'},
            {c:'🦓',n:'zebra'},{c:'🦍',n:'gorilla'},{c:'🐘',n:'elephant'},{c:'🦛',n:'hippo'},{c:'🦏',n:'rhino'},
            {c:'🐪',n:'camel'},{c:'🐫',n:'camel'},{c:'🦒',n:'giraffe'},{c:'🦘',n:'kangaroo'},{c:'🐃',n:'buffalo'},
            {c:'🐂',n:'ox'},{c:'🐄',n:'cow'},{c:'🐎',n:'horse'},{c:'🐖',n:'pig'},{c:'🐏',n:'ram'},
            {c:'🐑',n:'sheep'},{c:'🐐',n:'goat'},{c:'🦌',n:'deer'},{c:'🐕',n:'dog'},{c:'🐩',n:'poodle'},
            {c:'🐈',n:'cat'},{c:'🐓',n:'rooster'},{c:'🦃',n:'turkey'},{c:'🕊️',n:'dove'},{c:'🦜',n:'parrot'}
        ],
        'nature': [
            {c:'🌵',n:'cactus'},{c:'🎄',n:'christmas-tree'},{c:'🌲',n:'evergreen'},{c:'🌳',n:'deciduous'},{c:'🌴',n:'palm'},
            {c:'🌱',n:'seedling'},{c:'🌿',n:'herb'},{c:'☘️',n:'shamrock'},{c:'🍀',n:'clover'},{c:'🎍',n:'pine-decoration'},
            {c:'🎋',n:'tanabata'},{c:'🍃',n:'leaf'},{c:'🍂',n:'fallen-leaf'},{c:'🍁',n:'maple'},{c:'🍄',n:'mushroom'},
            {c:'🐚',n:'shell'},{c:'🌾',n:'rice'},{c:'💐',n:'bouquet'},{c:'🌷',n:'tulip'},{c:'🌹',n:'rose'},
            {c:'🥀',n:'wilted-flower'},{c:'🌺',n:'hibiscus'},{c:'🌸',n:'cherry-blossom'},{c:'🌼',n:'blossom'},{c:'🌻',n:'sunflower'},
            {c:'🌞',n:'sun'},{c:'🌝',n:'moon'},{c:'🌛',n:'moon'},{c:'🌜',n:'moon'},{c:'🌚',n:'moon'},
            {c:'🌕',n:'full-moon'},{c:'🌖',n:'moon'},{c:'🌗',n:'moon'},{c:'🌘',n:'moon'},{c:'🌑',n:'new-moon'},
            {c:'🌒',n:'moon'},{c:'🌓',n:'moon'},{c:'🌔',n:'moon'},{c:'🌙',n:'crescent'},{c:'🌍',n:'earth'},
            {c:'🌎',n:'earth'},{c:'🌏',n:'earth'},{c:'🪐',n:'saturn'},{c:'💫',n:'dizzy'},{c:'⭐️',n:'star'},
            {c:'🌟',n:'star'},{c:'✨',n:'sparkles'},{c:'⚡️',n:'lightning'},{c:'☄️',n:'comet'},{c:'💥',n:'boom'},
            {c:'🔥',n:'fire'},{c:'🌪',n:'tornado'},{c:'🌈',n:'rainbow'},{c:'☀️',n:'sun'},{c:'🌤',n:'cloud-sun'},
            {c:'⛅️',n:'cloud-sun'},{c:'🌥',n:'cloud-sun'},{c:'☁️',n:'cloud'},{c:'🌦',n:'cloud-rain'},{c:'🌧',n:'rain'},
            {c:'⛈',n:'storm'},{c:'🌩',n:'lightning'},{c:'❄️',n:'snow'},{c:'☃️',n:'snowman'},{c:'🌬',n:'wind'},
            {c:'💨',n:'wind'},{c:'💧',n:'droplet'},{c:'💦',n:'sweat'},{c:'🌊',n:'wave'},{c:'🌫',n:'fog'}
        ],
        'food': [
            {c:'🍏',n:'apple'},{c:'🍎',n:'apple'},{c:'🍐',n:'pear'},{c:'🍊',n:'orange'},{c:'🍋',n:'lemon'},
            {c:'🍌',n:'banana'},{c:'🍉',n:'watermelon'},{c:'🍇',n:'grapes'},{c:'🍓',n:'strawberry'},{c:'🫐',n:'blueberries'},
            {c:'🍈',n:'melon'},{c:'🍒',n:'cherries'},{c:'🍑',n:'peach'},{c:'🥭',n:'mango'},{c:'🍍',n:'pineapple'},
            {c:'🥥',n:'coconut'},{c:'🥝',n:'kiwi'},{c:'🍅',n:'tomato'},{c:'🍆',n:'eggplant'},{c:'🥑',n:'avocado'},
            {c:'🥦',n:'broccoli'},{c:'🥬',n:'leafy-green'},{c:'🥒',n:'cucumber'},{c:'🌶️',n:'hot-pepper'},{c:'🌽',n:'corn'},
            {c:'🥕',n:'carrot'},{c:'🫒',n:'olive'},{c:'🧄',n:'garlic'},{c:'🧅',n:'onion'},{c:'🥔',n:'potato'},
            {c:'🍠',n:'sweet-potato'},{c:'🥐',n:'croissant'},{c:'🥯',n:'bagel'},{c:'🍞',n:'bread'},{c:'🥖',n:'baguette'},
            {c:'🥨',n:'pretzel'},{c:'🧀',n:'cheese'},{c:'🥚',n:'egg'},{c:'🍳',n:'cooking'},{c:'バター',n:'butter'},
            {c:'🥞',n:'pancakes'},{c:'🧇',n:'waffle'},{c:'🥓',n:'bacon'},{c:'🥩',n:'meat'},{c:'🍗',n:'poultry'},
            {c:'🍖',n:'meat-on-bone'},{c:'🌭',n:'hotdog'},{c:'🍔',n:'hamburger'},{c:'🍟',n:'fries'},{c:'🍕',n:'pizza'},
            {c:'🌮',n:'taco'},{c:'🌯',n:'burrito'},{c:'🥙',n:'stuffed-flatbread'},{c:'🥘',n:'shallow-pan'},{c:'🍝',n:'spaghetti'},
            {c:'🍜',n:'ramen'},{c:'🍲',n:'pot'},{c:'🍛',n:'curry'},{c:'🍣',n:'sushi'},{c:'🍱',n:'bento'},
            {c:'🥟',n:'dumpling'},{c:'🍤',n:'shrimp'},{c:'🍥',n:'fish-cake'},{c:'🥠',n:'fortune-cookie'},{c:'🍢',n:'oden'},
            {c:'🍡',n:'dango'},{c:'🍧',n:'shaved-ice'},{c:'🍨',n:'ice-cream'},{c:'🍦',n:'soft-serve'},{c:'🥧',n:'pie'},
            {c:'🍰',n:'cake'},{c:'🎂',n:'cake'},{c:'🍮',n:'custard'},{c:'🍭',n:'lollipop'},{c:'🍬',n:'candy'},
            {c:'🍫',n:'chocolate'},{c:'🍿',n:'popcorn'},{c:'🍩',n:'doughnut'},{c:'🍪',n:'cookie'},{c:'🌰',n:'chestnut'},
            {c:'🥜',n:'peanuts'},{c:'🍯',n:'honey'},{c:'🥛',n:'milk'},{c:'🍼',n:'bottle'},{c:'☕',n:'coffee'},
            {c:'🍵',n:'tea'},{c:'🧃',n:'juice'},{c:'🥤',n:'cup'},{c:'🍶',n:'sake'},{c:'🍺',n:'beer'},
            {c:'🍻',n:'beers'},{c:'🥂',n:'clink'},{c:'🍷',n:'wine'},{c:'🥃',n:'whiskey'},{c:'🍸',n:'cocktail'}
        ],
        'travel': [
            {c:'🚗',n:'car'},{c:'🚕',n:'taxi'},{c:'🚙',n:'suv'},{c:'🚌',n:'bus'},{c:'🚎',n:'trolleybus'},
            {c:'🏎️',n:'racing-car'},{c:'🚓',n:'police-car'},{c:'🚑',n:'ambulance'},{c:'🚒',n:'fire-engine'},{c:'🚐',n:'minibus'},
            {c:'🚚',n:'truck'},{c:'🚛',n:'lorry'},{c:'🚜',n:'tractor'},{c:'🚲',n:'bicycle'},{c:'🛴',n:'scooter'},
            {c:'🛵',n:'scooter'},{c:'🏍️',n:'motorcycle'},{c:'🛺',n:'rickshaw'},{c:'🚨',n:'siren'},{c:'🛣️',n:'motorway'},
            {c:'🛤️',n:'railway'},{c:'⛽',n:'fuel'},{c:'🚧',n:'construction'},{c:'🚦',n:'traffic-light'},{c:'🚥',n:'traffic-light'},
            {c:'🛑',n:'stop'},{c:'🗺️',n:'map'},{c:'🧭',n:'compass'},{c:'🏔️',n:'mountain'},{c:'⛰️',n:'mountain'},
            {c:'🌋',n:'volcano'},{c:'🗻',n:'fuji'},{c:'🏕️',n:'camping'},{c:'🏖️',n:'beach'},{c:'🏜️',n:'desert'},
            {c:'🏝️',n:'island'},{c:'🏞️',n:'national-park'},{c:'🏟️',n:'stadium'},{c:'🏛️',n:'classical'},{c:'🏗️',n:'construction'},
            {c:'🏠',n:'house'},{c:'🏡',n:'house-garden'},{c:'🏢',n:'office'},{c:'🏣',n:'post-office'},{c:'🏤',n:'post-office'},
            {c:'🏥',n:'hospital'},{c:'🏦',n:'bank'},{c:'🏨',n:'hotel'},{c:'🏩',n:'love-hotel'},{c:'🏪',n:'convenience'},
            {c:'🏫',n:'school'},{c:'🏬',n:'department-store'},{c:'🏭',n:'factory'},{c:'🏯',n:'japanese-castle'},{c:'🏰',n:'castle'},
            {c:'💒',n:'wedding'},{c:'🗼',n:'tokyo-tower'},{c:'🗽',n:'statue-of-liberty'},{c:'⛪',n:'church'},{c:'🕌',n:'mosque'},
            {c:'🛕',n:'hindu-temple'},{c:'🕍',n:'synagogue'},{c:'⛩️',n:'shinto-shrine'},{c:'🕋',n:'kaaba'},{c:'⛲',n:'fountain'},
            {c:'⛺',n:'tent'},{c:'🌁',n:'foggy'},{c:'🌃',n:'night'},{c:'🏙️',n:'cityscape'},{c:'🌄',n:'sunrise'},
            {c:'🌅',n:'sunrise'},{c:'🌆',n:'dusk'},{c:'🌇',n:'sunset'},{c:'🌉',n:'bridge'},{c:'♨️',n:'hot-springs'},
            {c:'🎠',n:'carousel'},{c:'🎡',n:'ferris-wheel'},{c:'🎢',n:'roller-coaster'},{c:'💈',n:'barber'},{c:'🎪',n:'circus'},
            {c:'🚂',n:'locomotive'},{c:'🚃',n:'railway-car'},{c:'🚄',n:'high-speed-train'},{c:'🚅',n:'bullet-train'},{c:'🚆',n:'train'},
            {c:'🚇',n:'metro'},{c:'🚈',n:'light-rail'},{c:'🚉',n:'station'},{c:'🚊',n:'tram'},{c:'🚝',n:'monorail'},
            {c:'🚞',n:'mountain-railway'},{c:'🚋',n:'tram-car'},{c:'🚌',n:'bus'},{c:'🚍',n:'oncoming-bus'},{c:'🚎',n:'trolleybus'},
            {c:'🚐',n:'minibus'},{c:'🚑',n:'ambulance'},{c:'🚒',n:'fire-engine'},{c:'🚓',n:'police'},{c:'🚔',n:'police'},
            {c:'🚕',n:'taxi'},{c:'🚖',n:'taxi'},{c:'🚗',n:'car'},{c:'🚘',n:'car'},{c:'🚙',n:'suv'},
            {c:'🚚',n:'truck'},{c:'🚛',n:'lorry'},{c:'🚜',n:'tractor'},{c:'🏎️',n:'racing'},{c:'🏍️',n:'motorcycle'},
            {c:'🛵',n:'scooter'},{c:'🚲',n:'bicycle'},{c:'🛴',n:'scooter'},{c:' skateboard',n:'skateboard'},{c:'🛺',n:'rickshaw'},
            {c:'⚓',n:'anchor'},{c:'⛵',n:'sailboat'},{c:'🛶',n:'canoe'},{c:'🚤',n:'speedboat'},{c:'🛳️',n:'ship'},
            {c:'⛴️',n:'ferry'},{c:'🛥️',n:'boat'},{c:'🚢',n:'ship'},{c:'✈️',n:'airplane'},{c:'🛩️',n:'small-airplane'},
            {c:'🛫',n:'departure'},{c:'🛬',n:'arrival'},{c:'🪂',n:'parachute'},{c:'💺',n:'seat'},{c:'🚁',n:'helicopter'},
            {c:'🚟',n:'suspension'},{c:'🚠',n:'cableway'},{c:'🚡',n:'tramway'},{c:'🚀',n:'rocket'},{c:'🛸',n:'saucer'}
        ],
        'activities': [
            {c:'⚽',n:'soccer'},{c:'🏀',n:'basketball'},{c:'🏈',n:'football'},{c:'⚾',n:'baseball'},{c:'🥎',n:'softball'},
            {c:'🎾',n:'tennis'},{c:'🏐',n:'volleyball'},{c:'🏉',n:'rugby'},{c:'🎱',n:'billiards'},{c:'🏓',n:'ping-pong'},
            {c:'🏸',n:'badminton'},{c:'🏒',n:'hockey'},{c:'🏑',n:'field-hockey'},{c:'🥍',n:'lacrosse'},{c:'🏏',n:'cricket'},
            {c:'🥅',n:'goal'},{c:'⛳',n:'golf'},{c:'🪁',n:'kite'},{c:'🏹',n:'archery'},{c:'🎣',n:'fishing'},
            {c:'🤿',n:'diving'},{c:'🥊',n:'boxing'},{c:'🥋',n:'martial-arts'},{c:'⛸️',n:'skate'},{c:'🎿',n:'ski'},
            {c:'🛷',n:'sled'},{c:'🥌',n:'curling'},{c:'🎯',n:'bullseye'},{c:'🪀',n:'yo-yo'},{c:'🎮',n:'video-game'},
            {c:'🕹️',n:'joystick'},{c:'🎰',n:'slot'},{c:'🎲',n:'die'},{c:'🧩',n:'jigsaw'},{c:'🧸',n:'teddy'},
            {c:'♠️',n:'spade'},{c:'♥️',n:'heart'},{c:'♦️',n:'diamond'},{c:'♣️',n:'club'},{c:'♟️',n:'pawn'},
            {c:'🃏',n:'joker'},{c:'🀄',n:'mahjong'},{c:'🎴',n:'playing-cards'},{c:'🎭',n:'theater'},{c:'🎨',n:'art'},
            {c:'🧵',n:'thread'},{c:'🧶',n:'yarn'},{c:'🧗',n:'climbing'},{c:'🚴',n:'cycling'},{c:'🚵',n:'mountain-biking'}
        ],
        'objects': [
            {c:'⌚',n:'watch'},{c:'📱',n:'mobile'},{c:'📲',n:'calling'},{c:'💻',n:'laptop'},{c:'⌨️',n:'keyboard'},
            {c:'🖱️',n:'mouse'},{c:'🖨️',n:'printer'},{c:'🖥️',n:'desktop'},{c:'📺',n:'tv'},{c:'📷',n:'camera'},
            {c:'📸',n:'flash-camera'},{c:'📹',n:'video-camera'},{c:'📼',n:'vhs'},{c:'🔍',n:'magnifier'},{c:'🔎',n:'magnifier'},
            {c:'🕯️',n:'candle'},{c:'💡',n:'bulb'},{c:'🔦',n:'flashlight'},{c:'🏮',n:'lantern'},{c:'📔',n:'notebook'},
            {c:'📕',n:'book'},{c:'📖',n:'open-book'},{c:'📜',n:'scroll'},{c:'📄',n:'page'},{c:'📰',n:'newspaper'},
            {c:'🔖',n:'bookmark'},{c:'💰',n:'money'},{c:'🪙',n:'coin'},{c:'💵',n:'dollar'},{c:'💳',n:'card'},
            {c:'💎',n:'gem'},{c:'⚖️',n:'scales'},{c:'🔧',n:'wrench'},{c:'🔨',n:'hammer'},{c:'⚒️',n:'pick'},
            {c:'🛠️',n:'tools'},{c:'⛏️',n:'pick'},{c:'🔩',n:'bolt'},{c:'⚙️',n:'gear'},{c:'🧱',n:'brick'},
            {c:'⛓️',n:'chains'},{c:'🧰',n:'toolbox'},{c:'🧲',n:'magnet'},{c:'🧪',n:'test-tube'},{c:'🌡️',n:'thermometer'},
            {c:'🩹',n:'bandage'},{c:'🩺',n:'stethoscope'},{c:'🧺',n:'basket'},{c:'🧹',n:'broom'},{c:'🚽',n:'toilet'},
            {c:'🪠',n:'plunger'},{c:'🛁',n:'bathtub'},{c:'🔑',n:'key'},{c:'🗝️',n:'old-key'},{c:'🛌',n:'bed'},
            {c:'🖼️',n:'picture'},{c:'🛍️',n:'shopping-bags'},{c:'🛒',n:'cart'},{c:'🎁',n:'gift'}
        ],
        'symbols': [
            {c:'✨',n:'sparkles'},{c:'⭐',n:'star'},{c:'🌟',n:'star'},{c:'💫',n:'dizzy'},{c:'💥',n:'boom'},
            {c:'💨',n:'dash'},{c:'💦',n:'sweat'},{c:'🔥',n:'fire'},{c:'🌈',n:'rainbow'},{c:'☀️',n:'sun'},
            {c:'🌤️',n:'cloud-sun'},{c:'☁️',n:'cloud'},{c:'🌦️',n:'cloud-rain'},{c:'🌧️',n:'rain'},{c:'⛈️',n:'storm'},
            {c:'🌩️',n:'lightning'},{c:'❄️',n:'snow'},{c:'☃️',n:'snowman'},{c:'⚡',n:'lightning'},{c:'☄️',n:'comet'},
            {c:'💧',n:'droplet'},{c:'🌊',n:'wave'},{c:'🎃',n:'pumpkin'},{c:'🎄',n:'tree'},{c:'🎆',n:'fireworks'},
            {c:'🧨',n:'firecracker'},{c:'🎈',n:'balloon'},{c:'🎉',n:'party'},{c:'🎊',n:'confetti'},{c:'🎋',n:'tanabata'},
            {c:'⚧️',n:'transgender'},{c:'➕',n:'plus'},{c:'➖',n:'minus'},{c:'✖️',n:'multiply'},{c:'➗',n:'divide'},
            {c:'♾️',n:'infinity'},{c:'‼️',n:'exclamation'},{c:'⁉️',n:'question-exclamation'},{c:'❓',n:'question'},
            {c:'❔',n:'question'},{c:'❕',n:'exclamation'},{c:'❗',n:'exclamation'},{c:'〰️',n:'wavy-dash'},
            {c:'⚕️',n:'medical'},{c:'♻️',n:'recycle'},{c:'⚜️',n:'fleur-de-lis'},{c:'🔱',n:'trident'},
            {c:'📛',n:'badge'},{c:'🔰',n:'beginner'},{c:'⭕',n:'circle'},{c:'✅',n:'check'},{c:'☑️',n:'check'},
            {c:'✔️',n:'check'},{c:'❌',n:'cross'},{c:'✖️',n:'cross'},{c:'❎',n:'cross'},{c:'➰',n:'curly-loop'},
            {c:'➿',n:'double-loop'},{c:'〽️',n:'part-alternation-mark'},{c:'✳️',n:'asterisk'},{c:'✴️',n:'eight-pointed-star'},
            {c:'❇️',n:'sparkle'},{c:'©️',n:'copyright'},{c:'®️',n:'registered'},{c:'™️',n:'tm'}
        ],
        'flags': [
            {c:'🇦🇺',n:'australia'},{c:'🇹🇭',n:'thailand'},{c:'🇺🇸',n:'usa'},{c:'🇬🇧',n:'uk'},{c:'🇯🇵',n:'japan'},
            {c:'🇰🇷',n:'korea'},{c:'🇩🇪',n:'germany'},{c:'🇫🇷',n:'france'},{c:'🇪🇸',n:'spain'},{c:'🇮🇹',n:'italy'},
            {c:'🇷🇺',n:'russia'},{c:'🇨🇳',n:'china'},{c:'🇨🇦',n:'canada'},{c:'🇧🇷',n:'brazil'},{c:'🏴‍☠️',n:'pirate'}
        ]
    },

    init: function() {
        this.createTrigger();
        this.createPicker();
        this.setupListeners();
    },

    createTrigger: function() {
        const btn = document.createElement('button');
        btn.className = 'emoji-picker-trigger';
        btn.innerHTML = '😀';
        btn.type = 'button';
        btn.title = 'Insert Emoji';
        btn.style.zIndex = '100001';
        document.body.appendChild(btn);
        this.triggerBtn = btn;
    },

    createPicker: function() {
        const panel = document.createElement('div');
        panel.className = 'emoji-picker-panel';
        panel.style.display = 'none';
        panel.style.zIndex = '100002';
        
        panel.innerHTML = `
            <div class="emoji-picker-header">
                <input type="text" class="emoji-search" placeholder="Search 1000+ emojis...">
            </div>
            <div class="emoji-grid"></div>
            <div class="emoji-categories">
                <span class="category-btn active" data-cat="smileys" title="Smileys">😀</span>
                <span class="category-btn" data-cat="people" title="People">👋</span>
                <span class="category-btn" data-cat="animals" title="Animals">🐶</span>
                <span class="category-btn" data-cat="nature" title="Nature">🌲</span>
                <span class="category-btn" data-cat="food" title="Food">🍕</span>
                <span class="category-btn" data-cat="travel" title="Travel">✈️</span>
                <span class="category-btn" data-cat="activities" title="Activities">⚽</span>
                <span class="category-btn" data-cat="objects" title="Objects">💡</span>
                <span class="category-btn" data-cat="symbols" title="Symbols">✨</span>
                <span class="category-btn" data-cat="flags" title="Flags">🇦🇺</span>
            </div>
        `;
        
        document.body.appendChild(panel);
        this.pickerElement = panel;
        this.renderEmojis(this.emojis['smileys']);
    },

    renderEmojis: function(list) {
        const grid = this.pickerElement.querySelector('.emoji-grid');
        grid.innerHTML = '';
        
        list.forEach(emoji => {
            const span = document.createElement('span');
            span.className = 'emoji-item';
            span.innerHTML = emoji.c;
            span.title = emoji.n;
            span.onclick = (e) => {
                e.stopPropagation();
                this.insertEmoji(emoji.c);
            };
            grid.appendChild(span);
        });
    },

    setupListeners: function() {
        document.addEventListener('focusin', (e) => {
            const target = e.target;
            if (target.matches('.game-input, input[type="text"], textarea') && 
                !target.classList.contains('emoji-search')) {
                this.activeInput = target;
                this.attachTrigger(target);
            }
        });

        this.triggerBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.togglePicker();
        };

        const search = this.pickerElement.querySelector('.emoji-search');
        search.oninput = (e) => {
            const val = e.target.value.toLowerCase().trim();
            if (!val) {
                const activeCat = this.pickerElement.querySelector('.category-btn.active').dataset.cat;
                return this.renderEmojis(this.emojis[activeCat]);
            }
            
            let filtered = [];
            Object.values(this.emojis).forEach(cat => {
                filtered = filtered.concat(cat.filter(em => em.n.includes(val)));
            });
            this.renderEmojis(filtered);
        };

        this.pickerElement.querySelectorAll('.category-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                this.pickerElement.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                search.value = '';
                this.renderEmojis(this.emojis[btn.dataset.cat]);
            };
        });

        document.addEventListener('click', (e) => {
            if (this.pickerElement.style.display === 'flex' && 
                !this.pickerElement.contains(e.target) && 
                e.target !== this.triggerBtn) {
                this.closePicker();
            }
        });
    },

    attachTrigger: function(input) {
        const parent = input.parentElement;
        if (parent && (parent.classList.contains('form-group') || parent.classList.contains('modal-group') || parent.classList.contains('checkbox-group'))) {
            if (!parent.contains(this.triggerBtn)) {
                parent.appendChild(this.triggerBtn);
            }
            this.triggerBtn.style.display = 'block';
            this.triggerBtn.style.position = 'absolute';
            this.triggerBtn.style.top = `${input.offsetTop + (input.offsetHeight / 2)}px`;
            this.triggerBtn.style.left = `${input.offsetLeft + input.offsetWidth - 40}px`;
        }
    },

    togglePicker: function() {
        if (this.pickerElement.style.display === 'none') {
            this.openPicker();
        } else {
            this.closePicker();
        }
    },

    openPicker: function() {
        const rect = this.triggerBtn.getBoundingClientRect();
        this.pickerElement.style.display = 'flex';
        
        let top = rect.bottom + 5;
        let left = rect.right - 320;
        
        if (top + 400 > window.innerHeight) {
            top = rect.top - 405;
        }
        
        if (left < 10) left = 10;
        
        this.pickerElement.style.top = `${top}px`;
        this.pickerElement.style.left = `${left}px`;
        
        setTimeout(() => this.pickerElement.querySelector('.emoji-search').focus(), 10);
    },

    closePicker: function() {
        this.pickerElement.style.display = 'none';
    },

    insertEmoji: function(emoji) {
        const input = this.activeInput;
        if (!input) return;
        
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const text = input.value;
        
        input.value = text.substring(0, start) + emoji + text.substring(end);
        
        input.focus();
        input.selectionStart = input.selectionEnd = start + emoji.length;
        
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
};

document.addEventListener('DOMContentLoaded', () => EmojiPicker.init());
