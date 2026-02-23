/* /public/js/emoji-picker.js */

const EmojiPicker = {
    activeInput: null,
    pickerElement: null,
    triggerBtn: null,
    
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
            {c:'🤍',n:'white-heart'},{c:'🤎',n:'brown-heart'},{c:'☺',n:'smiling-face'},{c:'😙',n:'kissng-face-with-smiling-eyes'},{c:'🥲',n:'smiling-face-with-tears'},
            {c:'☹',n:'frowning-face'},{c:'😦',n:'frowning-face-with-open-mouth'},{c:'☠',n:'skull-and-cross-bone'},{c:'❣',n:'heart-exclamation'},{c:'❤️‍🔥',n:'heart-on-fire'},
            {c:'❤️‍🩹',n:'mending-heart'},{c:'❤',n:'red-heart'},{c:'💯',n:'hundredcorrect'},{c:'💢',n:'anger'},{c:'🕳',n:'hole'},
            {c:'💣',n:'bomb'},{c:'💬',n:'message-baloon'},{c:'👁️‍🗨️',n:'eye-in-speech-bubble'},{c:'🗨',n:'left-speech-bubble'},{c:'🗯',n:'anger-bubble'},
            {c:'💭',n:'thought-baloon'},{c:'💤',n:'zzz'}
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
            {c:'💃',n:'dancing'},{c:'🕺',n:'dancing'},{c:'👯',n:'partying'},{c:'🧖',n:'sauna'},{c:'🧗',n:'climbing'},
            {c:'✌',n:'victory-hand'},{c:'☝',n:'forehand-index-finger-pointing-up'},{c:'🫵',n:'index-finger-pointing-at-viewer'},{c:'✍',n:'writing-hands'},{c:'👣',n:'footprint'},
            {c:'🧔‍♂‍',n:'bearded-man'},{c:'🧔‍♀‍',n:'bearded-woman'},{c:'👨‍🦰',n:'man-with-red-hair'},{c:'👨‍🦱',n:'man-with-curly-hair'},{c:'👨‍🦳',n:'man-with-white-hair'},
            {c:'👨‍🦲',n:'bald-man'},{c:'👩‍🦰',n:'woman-with-red-hair'},{c:'👩‍🦱',n:'woman-with-curly-hair'},{c:'👩‍🦳',n:'woman-with-white-hair'},{c:'👩‍🦲',n:'bald-woman'},
            {c:'👱‍♀‍',n:'woman-with-blonde-hair'},{c:'👱‍♂‍',n:'man-with-blonde-hair'},{c:'🙍‍♂️',n:'man-frowning'},{c:'🙍‍♀️',n:'woman-frowning'},{c:'🙎‍♂️',n:'man-pouting'},
            {c:'🙎‍♀️',n:'woman-pouting'},{c:'🙅‍♂️',n:'man-gesturing-no'},{c:'🙅‍♀️',n:'woman-gesturing-no'},{c:'🙆‍♂️',n:'man-gesturing-ok'},{c:'🙆‍♀️',n:'woman-gesturing-ok'},
            {c:'💁‍♂️',n:'man-tipping-hand'},{c:'💁‍♀️',n:'woman-tipping-hand'},{c:'🙋‍♂️',n:'man-raising-hand'},{c:'🙋‍♀️',n:'woman-raising-hand'},{c:'🧏‍♂️',n:'deaf-man'},
            {c:'🧏‍♀️',n:'deaf-woman'},{c:'🙇‍♂️',n:'man-bowing'},{c:'🙇‍♀️',n:'woman-bowing'},{c:'🤦‍♂️',n:'man-facepalming'},{c:'🤦‍♀️',n:'woman-facepalming'},
            {c:'🤷‍♂️',n:'man-shrugging'},{c:'🤷‍♀️',n:'woman-shrugging'},{c:'🧑‍⚕️',n:'health-worker'},{c:'👨‍⚕️',n:'man-health-worker'},{c:'👩‍⚕️',n:'woman-health-worker'},
            {c:'🧑‍🎓',n:'student'},{c:'🧑‍🏫',n:'teacher'},{c:'🧑‍⚖️',n:'judge'},{c:'🧑‍🌾',n:'farmer'},{c:'👨‍🌾',n:'man-farmer'},
            {c:'👩‍🌾',n:'woman-farmer'},{c:'🧑‍🍳',n:'cook'},{c:'🧑‍🔧',n:'mechanic'},{c:'🧑‍🏭',n:'factory-worker'},{c:'👨‍🏭',n:'man-factory-worker'},
            {c:'👩‍🏭',n:'woman-factory-worker'},{c:'🧑‍💼',n:'office-worker'},{c:'🧑‍🔬',n:'scientist'},{c:'🧑‍💻',n:'technologist'},{c:'🧑‍🎤',n:'singer'},
            {c:'🧑‍🎨',n:'artist'},{c:'🧑‍✈️',n:'pilot'},{c:'🧑‍🚀',n:'astronaut'},{c:'🧑‍🚒',n:'firefighter'},{c:'👮‍♂️',n:'man-police'},
            {c:'👮‍♀️',n:'woman-police'},{c:'🕵️‍♂️',n:'man-detective'},{c:'🕵️‍♀️',n:'woman-detective'},{c:'💂‍♂️',n:'man-guard'},{c:'💂‍♀️',n:'woman-guard'},
            {c:'👷‍♂️',n:'man-construction-worker'},{c:'👷‍♀️',n:'woman-construction-worker'},{c:'👳‍♂️',n:'man-wearing-turban'},{c:'👳‍♀️',n:'woman-wearing-turban'},{c:'🧑‍🍼',n:'person-feeding-baby'},
            {c:'👩‍🍼',n:'woman-feeding-baby'},{c:'👨‍🍼',n:'man-feeding-baby'},{c:'🧑‍🎄',n:'mx-claus'},{c:'🦸‍♂️',n:'man-superhero'},{c:'🦸‍♀️',n:'woman-superhero'},
            {c:'🦹‍♂️',n:'man-supervillain'},{c:'🦹‍♀️',n:'woman-supervillain'},{c:'🧙‍♂️',n:'man-mage'},{c:'🧙‍♀️',n:'woman-mage'},{c:'🧚‍♂️',n:'man-fairy'},
            {c:'🧚‍♀️',n:'woman-fairy'},{c:'🧛‍♂️',n:'man-vampire'},{c:'🧛‍♀️',n:'woman-vampire'},{c:'🧜‍♂️',n:'merman'},{c:'🧜‍♀️',n:'mermaid'},
            {c:'🧝‍♂️',n:'man-elf'},{c:'🧝‍♀️',n:'woman-elf'},{c:'🧞‍♂️',n:'man-genie'},{c:'🧞‍♀️',n:'woman-genie'},{c:'🧟‍♂️',n:'man-zombie'},
            {c:'🧟‍♀️',n:'woman-zombie'},{c:'💆‍♂️',n:'man-getting-massage'},{c:'💆‍♀️',n:'woman-getting-massage'},{c:'💇‍♂️',n:'man-getting-haircut'},{c:'💇‍♀️',n:'woman-getting-haircut'},
            {c:'🚶‍♂️',n:'man-walking'},{c:'🚶‍♀️',n:'woman-walking'},{c:'🧍‍♂️',n:'man-standing'},{c:'🧍‍♀️',n:'woman-standing'},{c:'🧎‍♂️',n:'man-kneeling'},
            {c:'🧎‍♀️',n:'woman-kneeling'},{c:'🧑‍🦯',n:'person-with-white-cane'},{c:'👨‍🦯',n:'man-with-white-cane'},{c:'👩‍🦯',n:'woman-with-white-cane'},{c:'🧑‍🦼',n:'person-with-motorized-wheelchair'},
            {c:'👨‍🦼',n:'man-in-motorized-wheelchair'},{c:'👩‍🦼',n:'woman-in-motorized-wheelchair'},{c:'🧑‍🦽',n:'person-in-manual-wheelchair'},{c:'👨‍🦽',n:'man-in-manual-wheelchair'},{c:'👩‍🦽',n:'woman-in-manual-wheelchair'},
            {c:'🏃‍♂️',n:'man-running'},{c:'🏃‍♀️',n:'woman-running'},{c:'👯‍♂️',n:'men-with-bunny-ears'},{c:'👯‍♀️',n:'women-with-bunny-ears'},{c:'🧖‍♂️',n:'man-in-steamy-room'},
            {c:'🧖‍♀️',n:'woman-in-steamy-room'},{c:'🧗‍♂️',n:'man-climbing'},{c:'🧗‍♀️',n:'woman-climbing'},{c:'🏌️‍♂️',n:'man-golfing'},{c:'🏌️‍♀️',n:'woman-golfing'},
            {c:'🧗‍♂‍',n:'man-climbing'},{c:'🧗‍♀‍',n:'woman-climbing'},{c:'🤺',n:'person-fencing'},{c:'🏇',n:'horse-racing'},{c:'⛷',n:'skier'},
            {c:'🏂',n:'snowboarder'},{c:'🏌',n:'person-playing-golf'},{c:'🏌️‍♂‍',n:'man-playing-golf'},{c:'🏌️‍♀‍',n:'woman-playing-golf'},{c:'🏄',n:'person-surfing'},
            {c:'🏄‍♂️',n:'man-sufing'},{c:'🏄‍♀️',n:'woman-surfing'},{c:'🚣',n:'person-rowing-boat'},{c:'🚣‍♂️',n:'man-rowing-boat'},{c:'🚣‍♀️',n:'woman-rowing-boat'},
            {c:'🏊',n:'person-swimming'},{c:'🏊‍♂️',n:'man-swimming'},{c:'🏊‍♀️',n:'woman-swimming'},{c:'⛹',n:'person-bouncing-ball'},{c:'⛹️‍♂️',n:'man-bouncing-ball'},
            {c:'⛹️‍♀️',n:'woman-bouncing-ball'},{c:'🏋',n:'person-lifting-weight'},{c:'🏋️‍♂️',n:'man-lifting-weights'},{c:'🏋️‍♀️',n:'woman-lifting-weights'},{c:'🚴‍♂️',n:'man-cycling'},
            {c:'🚴‍♀️',n:'woman-cycling'},{c:'🚵‍♂️',n:'man-mountain-biking'},{c:'🚵‍♀️',n:'woman-mountain-biking'},{c:'🤸',n:'person-cartwheeling'},{c:'🤸‍♂️',n:'man-cartwheeling'},
            {c:'🤸‍♀️',n:'woman-cartwheeling'},{c:'🤼',n:'people-wrestling'},{c:'🤼‍♂️',n:'men-wrestling'},{c:'🤼‍♀️',n:'women-wrestling'},{c:'🤽',n:'person-playing-water-polo'},
            {c:'🤽‍♂️',n:'man-playing-water-polo'},{c:'🤽‍♀️',n:'woman-playing-water-polo'},{c:'🤾',n:'person-playing-handball'},{c:'🤾‍♂️',n:'man-playing-handball'},{c:'🤾‍♀️',n:'woman-playing-handblall'},
            {c:'🤹',n:'person-juggling'},{c:'🤹‍♂️',n:'man-juggling'},{c:'🤹‍♀️',n:'woman-juggling'},{c:'🧘',n:'person-lotus-position'},{c:'🧘‍♂️',n:'man-in-lotus-position'},
            {c:'🧘‍♀️',n:'woman-in-lotus-position'},{c:'🛀',n:'person-bathing'},{c:'👪',n:'family'},{c:'👨‍👩‍👦',n:'family-of-man,-woman-and-boy'},{c:'👨‍👩‍👧',n:'family-of-man,-woman-and-girl'},
            {c:'👨‍👩‍👧‍👦',n:'family-of-man,-woman,-boy,-and-girl'},{c:'👨‍👩‍👦‍👦',n:'family-of-man,-woman,-boy,-and-boy'},{c:'👨‍👩‍👧‍👧',n:'family-of-man,-woman,-girl,-and-girl'},{c:'👨‍👨‍👦',n:'family-of-man,-man,-and-boy'},{c:'👨‍👨‍👧',n:'family-of-man,-man,-and-girl'},
            {c:'👨‍👨‍👧‍👦',n:'family-of-man,-man,-girl,-and-boy'},{c:'👨‍👨‍👦‍👦',n:'family-of-man,-man,-boy,-and-boy'},{c:'👨‍👨‍👧‍👧',n:'family-of-man,-man,-girl,-and-girl'},{c:'👩‍👩‍👦',n:'family-of-woman,-woman,-and-boy'},{c:'👩‍👩‍👧',n:'family-of-woman,-woman,-and-girl'},
            {c:'👩‍👩‍👧‍👦',n:'family-of-woman,-woman,-girl,-and-boy'},{c:'👩‍👩‍👦‍👦',n:'family-of-woman,-woman,-boy,-and-boy'},{c:'👩‍👩‍👧‍👧',n:'family-of-woman,-woman,-girl,-and-girl'},{c:'👨‍👦',n:'family-of-man-and-boy'},{c:'👨‍👦‍👦',n:'family-of-man,-boy,-and-boy'},
            {c:'👨‍👧',n:'family-of-man-and-girl'},{c:'👨‍👧‍👦',n:'family-of-man,-girl,-and-boy'},{c:'👨‍👧‍👧',n:'family-of-man,-girl,-and-girl'},{c:'👩‍👦',n:'family-of-woman,-and-boy'},{c:'👩‍👦‍👦',n:'family-of-woman,-boy,-and-boy'},
            {c:'👩‍👧',n:'family-of-woman,-and-girl'},{c:'👩‍👧‍👦',n:'family-of-woman,-girl,-and-boy'},{c:'👩‍👧‍👧',n:'family-of-woman,-girl,-and-girl'},{c:'🧑‍🤝‍🧑',n:'people-holding-hands'},{c:'👭',n:'women-holding-hands'},
            {c:'👫',n:'woman-and-man-holding-hands'},{c:'👬',n:'men-holding-hands'},{c:'💏',n:'kiss'},{c:'👩‍❤️‍💋‍👨',n:'woman-and-man-kissing'},{c:'👨‍❤️‍💋‍👨',n:'man-and-man-kissing'},
            {c:'👩‍❤️‍💋‍👩',n:'woman-and-woman-kissing'},{c:'👩‍❤️‍👨',n:'woman-and-man-couple'},{c:'👨‍❤️‍👨',n:'man-and-man-couple'},{c:'👩‍❤️‍👩',n:'woman-and-woman-couple'},{c:'💑',n:'couple-with-heart'},
            {c:'🗣',n:'person-speaking'},{c:'👤',n:'bust-in-silhouhette'},{c:'👥',n:'busts-in-silhouette'},{c:'🫂',n:'people-hugging'}
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
            {c:'🐈',n:'cat'},{c:'🐓',n:'rooster'},{c:'🦃',n:'turkey'},{c:'🕊️',n:'dove'},{c:'🦜',n:'parrot'},
            {c:'🐒',n:'monkey'},{c:'🦧',n:'orangutan'},{c:'🦮',n:'guide-dog'},{c:'🐕‍🦺',n:'service-dog'},{c:'🦝',n:'racoon'},
            {c:'🐈‍⬛',n:'black-cat'},{c:'🦬',n:'bison'},{c:'🐽',n:'pig-nose'},{c:'🦙',n:'llama'},{c:'🦣',n:'mammoth'},
            {c:'🐁',n:'mouse'},{c:'🐀',n:'rat'},{c:'🐹',n:'hamster'},{c:'🐇',n:'rabbit'},{c:'🐿',n:'chipmunk'},
            {c:'🦫',n:'beaver'},{c:'🦔',n:'hedgehog'},{c:'🦥',n:'sloth'},{c:'🦦',n:'otter'},{c:'🦨',n:'skunk'},
            {c:'🦡',n:'badger'},{c:'🐾',n:'paw-prints'},{c:'🐣',n:'hatching'},{c:'🐥',n:'front-facing-chick'},{c:'🐦‍⬛',n:'black-bird'},
            {c:'🕊',n:'dove'},{c:'🦢',n:'swan'},{c:'🦤',n:'dodo'},{c:'🪶',n:'feather'},{c:'🦩',n:'flamingo'},
            {c:'🐲',n:'dragon-face'},{c:'🐉',n:'dragon'},{c:'🦭',n:'seal'},{c:'🪲',n:'beetle'},{c:'🦗',n:'cricket'},
            {c:'🪳',n:'cockroach'},{c:'🕷',n:'spider'},{c:'🕸',n:'spider-web'},{c:'🦂',n:'scorpion'},{c:'🪰',n:'fly'},
            {c:'🪱',n:'worm'},{c:'🦠',n:'microbe'},{c:'💮',n:'white-flower'},{c:'🏵',n:'rosette'},{c:'🪴',n:'potted-plant'},
            {c:'☘',n:'shamrock'},{c:'🪹',n:'empty-nest'},{c:'🪺',n:'nest-with-eggs'}
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
            {c:'💨',n:'wind'},{c:'💧',n:'droplet'},{c:'💦',n:'sweat'},{c:'🌊',n:'wave'},{c:'🌫',n:'fog'},
            {c:'🌡',n:'thermometer'},{c:'☀',n:'sun'},{c:'🌠',n:'shooting-star'},{c:'🌌',n:'milky-way'},{c:'☁',n:'cloud'},
            {c:'⛅',n:'sun-behind-cloud'},{c:'🌨',n:'cloud-with-snow'},{c:'🌀',n:'cyclone'},{c:'🌂',n:'closed-umbrella'},{c:'☂',n:'umbrella'},
            {c:'☔',n:'umbrella-with-raindrops'},{c:'⛱',n:'umbrella-on-ground'},{c:'❄',n:'snowflake'},{c:'☃',n:'snowman'},{c:'⛄',n:'snowman-without-snow'},
            {c:'☄',n:'comet'}
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
            {c:'🍻',n:'beers'},{c:'🥂',n:'clink'},{c:'🍷',n:'wine'},{c:'🥃',n:'whiskey'},{c:'🍸',n:'cocktail'},
            {c:'🌶',n:'pepper'},{c:'🫑',n:'bell-pepper'},{c:'🫓',n:'flat-bread'},{c:'🥪',n:'sandwich'},{c:'🫔',n:'tamale'},
            {c:'🧆',n:'falafel'},{c:'🫕',n:'fondue'},{c:'🥣',n:'bowl-with-food'},{c:'🥗',n:'green-salad'},{c:'🧈',n:'butter'},
            {c:'🧂',n:'salt'},{c:'🥫',n:'canned-food'},{c:'🍘',n:'rice-cracker'},{c:'🍙',n:'rice-ball'},{c:'🍚',n:'cooked-rice'},
            {c:'🥮',n:'moon-cake'},{c:'🥡',n:'take-out-box'},{c:'🦪',n:'oyster'},{c:'🧁',n:'cup-cake'},{c:'🫖',n:'teapot'},
            {c:'🍾',n:'bottle-with-poppin-cork'},{c:'🍹',n:'tropical-drink'},{c:'🧋',n:'bubble-tea'},{c:'🧉',n:'mate-drink'},{c:'🧊',n:'ice'},
            {c:'🥢',n:'chopsticks'},{c:'🍽',n:'fork-and-knife-with-plate'},{c:'🍴',n:'fork-and-knife'},{c:'🥄',n:'spoon'},{c:'🔪',n:'kitchen-knife'},
            {c:'🏺',n:'amphora'}
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
            {c:'🚞',n:'mountain-railway'},{c:'🚋',n:'tram-car'},{c:'🚍',n:'oncoming-bus'},{c:'🚔',n:'police'},{c:'🚖',n:'taxi'},
            {c:'🚘',n:'car'},{c:' skateboard',n:'skateboard'},{c:'⚓',n:'anchor'},{c:'⛵',n:'sailboat'},{c:'🛶',n:'canoe'},
            {c:'🚤',n:'speedboat'},{c:'🛳️',n:'ship'},{c:'⛴️',n:'ferry'},{c:'🛥️',n:'boat'},{c:'🚢',n:'ship'},
            {c:'✈️',n:'airplane'},{c:'🛩️',n:'small-airplane'},{c:'🛫',n:'departure'},{c:'🛬',n:'arrival'},{c:'🪂',n:'parachute'},
            {c:'💺',n:'seat'},{c:'🚁',n:'helicopter'},{c:'🚟',n:'suspension'},{c:'🚠',n:'cableway'},{c:'🚡',n:'tramway'},
            {c:'🚀',n:'rocket'},{c:'🛸',n:'saucer'},{c:'🌐',n:'globe-with-meridians'},{c:'🗺',n:'world-map'},{c:'⛰',n:'mountain'},
            {c:'🏔',n:'snowcap-mountain'},{c:'🏕',n:'camping'},{c:'🏖',n:'beach-with-umbrella'},{c:'🏜',n:'desert'},{c:'🏝',n:'desertified-island'},
            {c:'🏞',n:'national-park'},{c:'🏟',n:'stadium'},{c:'🏛',n:'classical-building'},{c:'🏗',n:'building-construction'},{c:'🪨',n:'rock'},
            {c:'🪵',n:'wood'},{c:'🛖',n:'hut'},{c:'🏘',n:'houses'},{c:'🏚',n:'derelict-house'},{c:'⛩',n:'shinto-shrine'},
            {c:'🏙',n:'citscape'},{c:'♨',n:'hot-springs'},{c:'🛻',n:'pickup-truck'},{c:'🏎',n:'racing-car'},{c:'🏍',n:'motorcycle'},
            {c:'🦽',n:'manual-wheelchair'},{c:'🦼',n:'motorized-wheelchair'}
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
            {c:'🧵',n:'thread'},{c:'🧶',n:'yarn'},{c:'🚴',n:'cycling'},{c:'🚵',n:'mountain-biking'},{c:'🎇',n:'sparkler'},
            {c:'🎎',n:'japanese-dolls'},{c:'🎏',n:'carp-streamer'},{c:'🎑',n:'moon-viewing-ceremony'},{c:'🧧',n:'red-envelope'},{c:'🎀',n:'ribbon'},
            {c:'🎗',n:'reminder-ribbon'},{c:'🎟',n:'admission-ticket'},{c:'🎫',n:'ticket'},{c:'🎖',n:'military-medal'},{c:'🏆',n:'trophy'},
            {c:'🏅',n:'sports-medal'},{c:'🥇',n:'gold-medal---first-position'},{c:'🥈',n:'silver-medal---second-position'},{c:'🥉',n:'bronze-medal---third-position'},{c:'🥏',n:'flying-disk'},
            {c:'🎳',n:'bowling'},{c:'⛸',n:'ice-skate'},{c:'🎽',n:'running-shirt'},{c:'🔮',n:'crystal-ball'},{c:'🪄',n:'magic-wand'},
            {c:'🧿',n:'nazar-amulet'},{c:'🪬',n:'hamsa'},{c:'🕹',n:'joystick'},{c:'🪅',n:'piñata'},{c:'🪆',n:'nesting-doll'},
            {c:'♠',n:'spade-suit'},{c:'♥',n:'heart-suit'},{c:'♣',n:'club-suit'},{c:'♟',n:'chess-pawn'},{c:'🖼',n:'framed-picture'},
            {c:'🪡',n:'sewing-needle-with-thread'},{c:'🪢',n:'knot'}
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
            {c:'🖼️',n:'picture'},{c:'🛍️',n:'shopping-bags'},{c:'🛒',n:'cart'},{c:'🎁',n:'gift'},{c:'⌛',n:'hourglass-done'},
            {c:'⏳',n:'hourglass-starting'},{c:'⏰',n:'alarm'},{c:'⏱',n:'stopwatch'},{c:'⏲',n:'timer-clock'},{c:'🕰',n:'mantelpiece-clock'},
            {c:'🕛',n:'twelve-oclock'},{c:'🕧',n:'twelve-thirty'},{c:'🕐',n:'one-oclock'},{c:'🕜',n:'one-thirty'},{c:'🕑',n:'two-oclock'},
            {c:'🕝',n:'two-thirty'},{c:'🕒',n:'three-oclock'},{c:'🕞',n:'three-thirty'},{c:'🕓',n:'four-oclock'},{c:'🕟',n:'four-thirty'},
            {c:'🕔',n:'five-oclock'},{c:'🕠',n:'five-thirty'},{c:'🕕',n:'six-oclock'},{c:'🕡',n:'six-thirty'},{c:'🕖',n:'seven-oclock'},
            {c:'🕢',n:'seven-thirty'},{c:'🕗',n:'eight-oclock'},{c:'🕣',n:'eight-thirty'},{c:'🕘',n:'nine-oclock'},{c:'🕤',n:'nine-thirty'},
            {c:'🕙',n:'ten-oclock'},{c:'🕥',n:'ten-thirty'},{c:'🕚',n:'eleven-oclock'},{c:'🕦',n:'eleven-thirty'},{c:'👓',n:'glasses'},
            {c:'🕶',n:'sunglasses'},{c:'🥽',n:'goggles'},{c:'🥼',n:'lab-coat'},{c:'🦺',n:'safety-vest'},{c:'👔',n:'necktie'},
            {c:'👕',n:'t-shirt'},{c:'👖',n:'jeans'},{c:'🧣',n:'scarf'},{c:'🧤',n:'gloves'},{c:'🧥',n:'coat'},
            {c:'🧦',n:'socks'},{c:'👗',n:'dress'},{c:'👘',n:'kimono'},{c:'🥻',n:'sari'},{c:'🩱',n:'one-piece-suit'},
            {c:'🩲',n:'briefs'},{c:'🩳',n:'shorts'},{c:'👙',n:'bikini'},{c:'👚',n:'womans-shirt'},{c:'👛',n:'purse'},
            {c:'👜',n:'handbag'},{c:'👝',n:'clutch-bag'},{c:'🛍',n:'shopping-bags'},{c:'🎒',n:'backpack'},{c:'🩴',n:'thong-sandals'},
            {c:'👞',n:'mans-shoe'},{c:'👟',n:'running-shoe'},{c:'🥾',n:'hiking-boot'},{c:'🥿',n:'flat-shoe'},{c:'👠',n:'high-heeled-shoe'},
            {c:'👡',n:'womans-sandal'},{c:'🩰',n:'ballet-shoes'},{c:'👢',n:'womans-boot'},{c:'👑',n:'crown'},{c:'👒',n:'womans-hat'},
            {c:'🎩',n:'top-hat'},{c:'🎓',n:'graduation-cap'},{c:'🧢',n:'billed-cap'},{c:'🪖',n:'military-helmet'},{c:'⛑',n:'rescue-workers-helmet'},
            {c:'📿',n:'prayer-beads'},{c:'💄',n:'lipstick'},{c:'💍',n:'ring'},{c:'🔇',n:'muted-speaker'},{c:'🔈',n:'low-volume-speaker'},
            {c:'🔉',n:'mid-volume-speaker'},{c:'🔊',n:'high-volume-speaker'},{c:'📢',n:'loudspeaker'},{c:'📣',n:'megaphone'},{c:'📯',n:'postal-horn'},
            {c:'🔔',n:'bell'},{c:'🔕',n:'bell-with-slash'},{c:'🎼',n:'musical-score'},{c:'🎵',n:'musical-note'},{c:'🎶',n:'musical-notes'},
            {c:'🎙',n:'studio-microphone'},{c:'🎚',n:'level-slider'},{c:'🎛',n:'control-knobs'},{c:'🎤',n:'microphone'},{c:'🎧',n:'headphone'},
            {c:'📻',n:'radio'},{c:'🎷',n:'saxophone'},{c:'🪗',n:'accordion'},{c:'🎸',n:'guitar'},{c:'🎹',n:'musical-keyboard'},
            {c:'🎺',n:'trumpet'},{c:'🎻',n:'violin'},{c:'🪕',n:'banjo'},{c:'🥁',n:'drum'},{c:'🪘',n:'long-drum'},
            {c:'☎',n:'telephone'},{c:'📞',n:'telephone-receiver'},{c:'📟',n:'pager'},{c:'📠',n:'fax-machine'},{c:'🔋',n:'full-battery'},
            {c:'🪫',n:'low-battery'},{c:'🔌',n:'electric-plug'},{c:'🖥',n:'desktop-computer'},{c:'🖨',n:'printer'},{c:'⌨',n:'keyboard'},
            {c:'🖱',n:'mouse'},{c:'🖲',n:'trackball'},{c:'💽',n:'computer-disk'},{c:'💾',n:'floppy-disk'},{c:'💿',n:'optical-disk'},
            {c:'📀',n:'dvd'},{c:'🧮',n:'abacus'},{c:'🎥',n:'movie-camera'},{c:'🎞',n:'film-frames'},{c:'📽',n:'film-projector'},
            {c:'🎬',n:'clapper-board'},{c:'🕯',n:'candle'},{c:'🪔',n:'diya-lamp'},{c:'📗',n:'green-book'},{c:'📘',n:'blue-book'},
            {c:'📙',n:'orange-book'},{c:'📚',n:'orange-books'},{c:'📓',n:'notebook'},{c:'📒',n:'ledger'},{c:'📃',n:'page-with-curl'},
            {c:'🗞',n:'rolled-up-newspaper'},{c:'📑',n:'bookmark-tabs'},{c:'🏷',n:'label'},{c:'💴',n:'yen-banknote'},{c:'💶',n:'euro-banknote'},
            {c:'💷',n:'pound-banknote'},{c:'💸',n:'money-with-wings'},{c:'🧾',n:'receipt'},{c:'💹',n:'chart-increase-woth-yen'},{c:'✉',n:'envelope'},
            {c:'📧',n:'e-mail'},{c:'📩',n:'envelope-with-arrow'},{c:'📤',n:'outbox-tray'},{c:'📥',n:'inbox-tray'},{c:'📦',n:'package'},
            {c:'📫',n:'closed-mailbox-with-raised-flag'},{c:'📪',n:'closed-mailbox-with-lowered-flag'},{c:'📬',n:'open-mailbox-with-raised-flag'},{c:'📭',n:'open-mailbox-with-lowered-flag'},{c:'📮',n:'postbox'},
            {c:'🗳',n:'ballot-box-with-ballot'},{c:'✏',n:'pencil'},{c:'✒',n:'black-nib'},{c:'🖋',n:'fountain-pen'},{c:'🖊',n:'pen'},
            {c:'🖌',n:'paintbrush'},{c:'🖍',n:'crayon'},{c:'📝',n:'memo'},{c:'💼',n:'briefcase'},{c:'📁',n:'file-folder'},
            {c:'📂',n:'open-the-folder'},{c:'🗂',n:'card-index-dividers'},{c:'📅',n:'calender'},{c:'📆',n:'tear-off-calender'},{c:'📇',n:'card-index'},
            {c:'📈',n:'increasing-chart'},{c:'📉',n:'decreasing-chart'},{c:'📊',n:'bar-chart'},{c:'📋',n:'clipboard'},{c:'📌',n:'pushpin'},
            {c:'📍',n:'round-pushpin'},{c:'📎',n:'paperclip'},{c:'🖇',n:'linked-paperclips'},{c:'📏',n:'straight-ruler'},{c:'📐',n:'triangular-ruler'},
            {c:'✂',n:'scissors'},{c:'🗃',n:'card-file-box'},{c:'🗄',n:'file-cabinet'},{c:'🗑',n:'waste-basket'},{c:'🔒',n:'locked'},
            {c:'🔓',n:'unlocked'},{c:'🔏',n:'locked-with-pen'},{c:'🔐',n:'locked-with-key'},{c:'🗝',n:'old-key'},{c:'🪓',n:'axe'},
            {c:'⛏',n:'pick'},{c:'⚒',n:'hammer-and-pick'},{c:'🛠',n:'hammer-and-wrench'},{c:'🗡',n:'sword'},{c:'⚔',n:'crossed-swords'},
            {c:'🔫',n:'water-gun'},{c:'🪃',n:'boomerang'},{c:'🛡',n:'shield'},{c:'🪚',n:'carpentry-saw'},{c:'🪛',n:'screwdriver'},
            {c:'⚙',n:'wheel'},{c:'🗜',n:'clamp'},{c:'⚖',n:'balance-scale'},{c:'🦯',n:'white-cane'},{c:'🔗',n:'link'},
            {c:'⛓',n:'chains'},{c:'🪝',n:'hook'},{c:'🪜',n:'ladder'},{c:'⚗',n:'alembic'},{c:'🧫',n:'petri-dish'},
            {c:'🧬',n:'dna'},{c:'🔬',n:'microscope'},{c:'🔭',n:'telescope'},{c:'📡',n:'satelite-antenna'},{c:'💉',n:'syringe'},
            {c:'🩸',n:'a-droplet-of-blood'},{c:'💊',n:'pill'},{c:'🩼',n:'crutch'},{c:'🩻',n:'x-ray'},{c:'🚪',n:'door'},
            {c:'🛗',n:'elevator'},{c:'🪞',n:'mirror'},{c:'🪟',n:'window'},{c:'🛏',n:'bed'},{c:'🛋',n:'couch-and-lamp'},
            {c:'🪑',n:'chair'},{c:'🚿',n:'shower'},{c:'🪤',n:'mouse-trap'},{c:'🪒',n:'razor'},{c:'🧴',n:'lotion-bottle'},
            {c:'🧷',n:'safety-pin'},{c:'🧻',n:'roll-of-paper'},{c:'🪣',n:'bucket'},{c:'🧼',n:'soap'},{c:'🫧',n:'bubbles'},
            {c:'🪥',n:'toothbrush'},{c:'🧽',n:'sponge'},{c:'🧯',n:'fire-extinguisher'},{c:'🚬',n:'cigarette'},{c:'⚰',n:'casket'},
            {c:'🪦',n:'headstone'},{c:'⚱',n:'funeral-urn'},{c:'🗿',n:'moai'},{c:'🪧',n:'placard'},{c:'🪪',n:'id-card'}
        ],
        'symbols': [
            {c:'⭐',n:'star'},{c:'🌤️',n:'cloud-sun'},{c:'🌦️',n:'cloud-rain'},{c:'🌧️',n:'rain'},{c:'⛈️',n:'storm'},
            {c:'🌩️',n:'lightning'},{c:'⚡',n:'lightning'},{c:'🎃',n:'pumpkin'},{c:'🎆',n:'fireworks'},{c:'🧨',n:'firecracker'},
            {c:'🎈',n:'balloon'},{c:'🎉',n:'party'},{c:'🎊',n:'confetti'},{c:'⚧️',n:'transgender'},{c:'➕',n:'plus'},
            {c:'➖',n:'minus'},{c:'✖️',n:'multiply'},{c:'➗',n:'divide'},{c:'♾️',n:'infinity'},{c:'‼️',n:'exclamation'},
            {c:'⁉️',n:'question-exclamation'},{c:'❓',n:'question'},{c:'❔',n:'question'},{c:'❕',n:'exclamation'},{c:'❗',n:'exclamation'},
            {c:'〰️',n:'wavy-dash'},{c:'⚕️',n:'medical'},{c:'♻️',n:'recycle'},{c:'⚜️',n:'fleur-de-lis'},{c:'🔱',n:'trident'},
            {c:'📛',n:'badge'},{c:'🔰',n:'beginner'},{c:'⭕',n:'circle'},{c:'✅',n:'check'},{c:'☑️',n:'check'},
            {c:'✔️',n:'check'},{c:'❌',n:'cross'},{c:'❎',n:'cross'},{c:'➰',n:'curly-loop'},{c:'➿',n:'double-loop'},
            {c:'〽️',n:'part-alternation-mark'},{c:'✳️',n:'asterisk'},{c:'✴️',n:'eight-pointed-star'},{c:'❇️',n:'sparkle'},{c:'©️',n:'copyright'},
            {c:'®️',n:'registered'},{c:'™️',n:'tm'},{c:'🏧',n:'atm-sign'},{c:'🚮',n:'litter-in-bin'},{c:'🚰',n:'portable-water'},
            {c:'♿',n:'wheelchair-symbol'},{c:'🚹',n:'mens-room-symbol'},{c:'🚺',n:'womens-room-symbol'},{c:'🚻',n:'restroom-symbol'},{c:'🚼',n:'baby-symbol'},
            {c:'🚾',n:'water-closet'},{c:'🛂',n:'passport-control'},{c:'🛃',n:'customs'},{c:'🛄',n:'baggage-claim'},{c:'🛅',n:'left-laugage'},
            {c:'⚠',n:'warning'},{c:'🚸',n:'children-crossing'},{c:'⛔',n:'no-entry'},{c:'🚫',n:'prohibited'},{c:'🚳',n:'no-bicycles'},
            {c:'🚭',n:'no-smoking'},{c:'🚯',n:'no-littering'},{c:'🚱',n:'non-portable-water'},{c:'🚷',n:'no-pedestrians'},{c:'📵',n:'no-mobile-phones'},
            {c:'🔞',n:'no-one-under-18'},{c:'☢',n:'radioactive'},{c:'☣',n:'biohazard'},{c:'⬆',n:'up-arrow'},{c:'↗',n:'up-right-arrow'},
            {c:'➡',n:'right-arrow'},{c:'↘',n:'down-right-arrow'},{c:'⬇',n:'down-arrow'},{c:'↙',n:'down-left-arrow'},{c:'⬅',n:'left-arrow'},
            {c:'↖',n:'up-left-arrow'},{c:'↕',n:'up-down-arrow'},{c:'↔',n:'left-arrow'},{c:'↩',n:'right-arrow-curving-left'},{c:'↪',n:'left-arrow-curving-right'},
            {c:'⤴',n:'right-arrow-curving-up'},{c:'⤵',n:'right-arrow-curving-down'},{c:'🔃',n:'clockwise-vertical-arrow'},{c:'🔄',n:'counterclockwise-arrows-button'},{c:'🔙',n:'back-arrow'},
            {c:'🔚',n:'end-arrow'},{c:'🔛',n:'on-arrow'},{c:'🔜',n:'soon-arrow'},{c:'🔝',n:'top-arrow'},{c:'🛐',n:'place-of-worship'},
            {c:'⚛',n:'atom-symbol'},{c:'🕉',n:'om'},{c:'✡',n:'star-of-david'},{c:'☸',n:'wheel-of-dharma'},{c:'☯',n:'yin-yang'},
            {c:'✝',n:'latin-cross'},{c:'☦',n:'orthodox-cross'},{c:'☪',n:'star-and-cresent-moon'},{c:'☮',n:'peace'},{c:'🕎',n:'menorah'},
            {c:'🔯',n:'six-pointed-star'},{c:'♈',n:'aries'},{c:'♉',n:'taurus'},{c:'♊',n:'gemini'},{c:'♋',n:'cancer'},
            {c:'♌',n:'leo'},{c:'♍',n:'virgo'},{c:'♎',n:'libra'},{c:'♏',n:'scorpio'},{c:'♐',n:'sagittarius'},
            {c:'♑',n:'capricon'},{c:'♒',n:'acquarius'},{c:'♓',n:'pisces'},{c:'⛎',n:'ophiucus'},{c:'🔀',n:'shuffle-tracks'},
            {c:'🔁',n:'repeat-all'},{c:'🔂',n:'repeat-one'},{c:'▶',n:'play'},{c:'⏸',n:'pause'},{c:'⏩',n:'fast-forward'},
            {c:'⏭',n:'next-track'},{c:'⏯',n:'play-or-pause'},{c:'◀',n:'reverse'},{c:'⏪',n:'fast-reverse'},{c:'⏮',n:'previous-track'},
            {c:'🔼',n:'upwards'},{c:'⏫',n:'fast-up'},{c:'🔽',n:'downwards'},{c:'⏬',n:'fast-down'},{c:'⏹',n:'stop'},
            {c:'⏺',n:'record'},{c:'⏏',n:'eject'},{c:'🎦',n:'cinema'},{c:'🔅',n:'dim'},{c:'🔆',n:'bright'},
            {c:'📶',n:'network-antenna-bars'},{c:'📳',n:'vibration-mode'},{c:'📴',n:'mobile-phone-off'},{c:'♀',n:'female'},{c:'♂',n:'male'},
            {c:'⚧',n:'transgender'},{c:'✖',n:'times'},{c:'🟰',n:'equals'},{c:'♾',n:'infinity'},{c:'‼',n:'double-exclamation'},
            {c:'⁉',n:'exclamation-and-question-mark'},{c:'〰',n:'wavy-dash'},{c:'💱',n:'currency-exchange'},{c:'💲',n:'heavy-green-dollar-sign'},{c:'⚕',n:'medical-symbol'},
            {c:'♻',n:'recycling-symbol'},{c:'⚜',n:'fleur-de-lis'},{c:'☑',n:'blue-box-with-checkmark'},{c:'✔',n:'checkmark'},{c:'〽',n:'part-alternation-mark'},
            {c:'✳',n:'eight-spoked-asterisk'},{c:'✴',n:'eight-pointed-star'},{c:'❇',n:'sparkle'},{c:'©',n:'copyright-symbol'},{c:'®',n:'registered'},
            {c:'™',n:'trademark'},{c:'#️⃣',n:'#-keycap'},{c:'*️⃣',n:'*-keycap'},{c:'0️⃣',n:'0-keycap'},{c:'1️⃣',n:'1-keycap'},
            {c:'2️⃣',n:'2-keycap'},{c:'3️⃣',n:'3-keycap'},{c:'4️⃣',n:'4-keycap'},{c:'5️⃣',n:'5-keycap'},{c:'6️⃣',n:'6-keycap'},
            {c:'7️⃣',n:'7-keycap'},{c:'8️⃣',n:'8-keycap'},{c:'9️⃣',n:'9-keycap'},{c:'🔟',n:'10-keycap'},{c:'🔠',n:'input-latin-uppercase'},
            {c:'🔡',n:'input-latin-lowercase'},{c:'🔢',n:'input-numbers'},{c:'🔣',n:'input-symbols'},{c:'🔤',n:'input-latin-letters'},{c:'🅰',n:'a-blood-type'},
            {c:'🆎',n:'ab-blood-type'},{c:'🅱',n:'b-blood-type'},{c:'🅾',n:'o-blood-type'},{c:'🆑',n:'cl-button'},{c:'🆒',n:'cool-button'},
            {c:'🆓',n:'free-button'},{c:'ℹ',n:'info-button'},{c:'🆔',n:'id-button'},{c:'Ⓜ',n:'circled-m'},{c:'🆕',n:'new-button'},
            {c:'🆖',n:'ng-button'},{c:'🆗',n:'ok-button'},{c:'🅿',n:'p-button'},{c:'🆘',n:'sos-button'},{c:'🆙',n:'up!-button'},
            {c:'🆚',n:'vs-button'},{c:'🈁',n:'japanese-"here"-button'},{c:'🈂',n:'japanese-"service-charge"-button'},{c:'🈷',n:'japanese-"monthly-amount"-button'},{c:'🈶',n:'japanese-"not-free-of-charge"-button'},
            {c:'🈯',n:'japanese-"reserved"-button'},{c:'🉐',n:'japanese-"bargain"-button'},{c:'🈹',n:'japanese-"discount"-button'},{c:'🈚',n:'japanese-"free-of-charge"-button'},{c:'🈲',n:'japanese-"prohibited"-button'},
            {c:'🉑',n:'japanese-"acceptable"-button'},{c:'🈸',n:'japanese-"application"-button'},{c:'🈴',n:'japanese-"passing-grade"-button'},{c:'🈳',n:'japanese-"vacancy"-button'},{c:'㊗',n:'japanese-"congratulations"-button'},
            {c:'㊙',n:'japanese-"secret"-button'},{c:'🈺',n:'japanese-"open-for-business"-button'},{c:'🈵',n:'japanese-"no-vacancy"-button'},{c:'🔴',n:'red-circle'},{c:'🟠',n:'orange-circle'},
            {c:'🟡',n:'yellow-circle'},{c:'🟢',n:'green-circle'},{c:'🔵',n:'blue-circle'},{c:'🟣',n:'purple-circle'},{c:'🟤',n:'brown-circle'},
            {c:'⚫',n:'black-circle'},{c:'⚪',n:'white-circle'},{c:'🟥',n:'red-square'},{c:'🟧',n:'orange-square'},{c:'🟨',n:'yellow-square'},
            {c:'🟩',n:'green-square'},{c:'🟦',n:'blue-square'},{c:'🟪',n:'purple-square'},{c:'🟫',n:'brown-square'},{c:'⬛',n:'black-square'},
            {c:'⬜',n:'white-square'},{c:'🔶',n:'large-orange-diamond'},{c:'🔷',n:'large-blue-diamond'},{c:'🔸',n:'small-orange-diamond'},{c:'🔹',n:'small-blue-diamond'},
            {c:'🔺',n:'red-triangle-pointed-up'},{c:'🔻',n:'red-triangle-pointed-down'},{c:'💠',n:'diamond-with-a-dot'},{c:'🔘',n:'radio-button'},{c:'🔳',n:'white-square-button'},
            {c:'🔲',n:'black-square-button'}
        ],
        'flags': [
            {c:'🇦🇺',n:'australia'},{c:'🇹🇭',n:'thailand'},{c:'🇺🇸',n:'usa'},{c:'🇬🇧',n:'uk'},{c:'🇯🇵',n:'japan'},
            {c:'🇰🇷',n:'korea'},{c:'🇩🇪',n:'germany'},{c:'🇫🇷',n:'france'},{c:'🇪🇸',n:'spain'},{c:'🇮🇹',n:'italy'},
            {c:'🇷🇺',n:'russia'},{c:'🇨🇳',n:'china'},{c:'🇨🇦',n:'canada'},{c:'🇧🇷',n:'brazil'},{c:'🏴‍☠️',n:'pirate'},
            {c:'🏁',n:'chequered-flag'},{c:'🚩',n:'triangular-flag'},{c:'🎌',n:'crossed-flag'},{c:'🏴',n:'black-flag'},{c:'🏳',n:'white-flag'},
            {c:'🏳️‍🌈',n:'rainbow-flag'},{c:'🏳️‍⚧️',n:'transgender-flag'},{c:'🇦🇨',n:'ascension-island-flag'},{c:'🇦🇩',n:'andorra-flag'},{c:'🇦🇪',n:'uae-flag'},
            {c:'🇦🇫',n:'afghanistan-flag'},{c:'🇦🇬',n:'antigua-<span-class="entity"><span>&amp;</span>amp;</span>-barbuda-flag'},{c:'🇦🇮',n:'anguilla-flag'},{c:'🇦🇱',n:'albania'},{c:'🇩🇿',n:'algeria-flag'},
            {c:'🇦🇲',n:'armenia-flag'},{c:'🇦🇴',n:'angola-flag'},{c:'🇦🇶',n:'antarctica-flag'},{c:'🇦🇷',n:'argentina-flag'},{c:'🇦🇸',n:'american-samoa-flag'},
            {c:'🇦🇹',n:'austria-flag'},{c:'🇦🇼',n:'aruba-flag'},{c:'🇦🇽',n:'åland-islands-flag'},{c:'🇦🇿',n:'azerbaijan-flag'},{c:'🇧🇦',n:'bosnia-<span-class="entity"><span>&amp;</span>amp;</span>-herzegovina-flag'},
            {c:'🇧🇩',n:'bangladesh-flag'},{c:'🇧🇪',n:'belgium-flag'},{c:'🇧🇫',n:'burkina-faso-flag'},{c:'🇧🇬',n:'bulgaria-flag'},{c:'🇧🇭',n:'bahrain-flag'},
            {c:'🇧🇮',n:'burundi-flag'},{c:'🇧🇯',n:'benin-republic-flag'},{c:'🇧🇱',n:'st.-barthélemy-flag'},{c:'🇧🇲',n:'bermuda-flag'},{c:'🇧🇳',n:'brunei-flag'},
            {c:'🇧🇴',n:'bolivia-flag'},{c:'🇧🇶',n:'caribbean-netherlands-flag'},{c:'🇧🇸',n:'bahamas-flag'},{c:'🇧🇹',n:'bhutan-flag'},{c:'🇧🇻',n:'bouvet-island-flag'},
            {c:'🇧🇼',n:'botswana-flag'},{c:'🇧🇾',n:'belarus-flag'},{c:'🇧🇿',n:'belize-flag'},{c:'🇨🇨',n:'cocos-keeling-islands-flag'},{c:'🇨🇩',n:'dr-congo-flag'},
            {c:'🇨🇫',n:'central-african-republic-flag'},{c:'🇨🇬',n:'congo-brazzaville-flag'},{c:'🇨🇭',n:'switzerland-flag'},{c:'🇨🇮',n:'côte-d’ivoire-flag'},{c:'🇨🇰',n:'cook-islands-flag'},
            {c:'🇨🇱',n:'chile-flag'},{c:'🇨🇲',n:'cameroon-flag'},{c:'🇨🇴',n:'columbia-flag'},{c:'🇨🇵',n:'clipperton-island-flag'},{c:'🇨🇷',n:'costa-rica-flag'},
            {c:'🇨🇺',n:'cuba-flag'},{c:'🇨🇻',n:'cape-verde-flag'},{c:'🇨🇼',n:'curaçao-flag'},{c:'🇨🇽',n:'christmas-island-flag'},{c:'🇨🇾',n:'cyprus-flag'},
            {c:'🇨🇿',n:'czech-republic-flag'},{c:'🇩🇬',n:'diego-garcia-flag'},{c:'🇩🇯',n:'djibouti-flag'},{c:'🇩🇰',n:'denmark-flag'},{c:'🇩🇲',n:'dominica-flag'},
            {c:'🇩🇴',n:'dominican-republic-flag'},{c:'🇪🇦',n:'ceuta-<span-class="entity"><span>&amp;</span>amp;</span>-melilla-flag'},{c:'🇪🇨',n:'ecuador-flag'},{c:'🇪🇪',n:'estonia-flag'},{c:'🇪🇬',n:'egypt-flag'},
            {c:'🇪🇭',n:'western-sahara-flag'},{c:'🇪🇷',n:'eritre-flag'},{c:'🇪🇹',n:'ethiopia-flag'},{c:'🇪🇺',n:'european-union-flag'},{c:'🇫🇮',n:'finalnd-flag'},
            {c:'🇫🇯',n:'fiji-island-flag'},{c:'🇫🇰',n:'falkland-islands-flag'},{c:'🇫🇲',n:'micronesia-flag'},{c:'🇫🇴',n:'faroe-islands-flag'},{c:'🇬🇦',n:'gabon-flag'},
            {c:'🇬🇩',n:'grenada-flag'},{c:'🇬🇪',n:'georgia-flag'},{c:'🇬🇫',n:'french-guiana-flag'},{c:'🇬🇬',n:'guernsey-flag'},{c:'🇬🇭',n:'ghana-flag'},
            {c:'🇬🇮',n:'gibraltar-flag'},{c:'🇬🇱',n:'greenland-flag'},{c:'🇬🇲',n:'gambia-flag'},{c:'🇬🇳',n:'guinea-flag'},{c:'🇬🇵',n:'guadeloupe-flag'},
            {c:'🇬🇶',n:'equatorial-guinea-flag'},{c:'🇬🇷',n:'greece-flag'},{c:'🇬🇸',n:'south-georgia-<span-class="entity"><span>&amp;</span>amp;</span>-south-sandwich-islands-flag'},{c:'🇬🇹',n:'guatemala-flag'},{c:'🇬🇺',n:'guam-flag'},
            {c:'🇬🇼',n:'guinea-bissau-flag'},{c:'🇬🇾',n:'guyana-flag'},{c:'🇭🇰',n:'hong-kong-sar-china-flag'},{c:'🇭🇲',n:'heard-<span-class="entity"><span>&amp;</span>amp;</span>-mcdonald-islands-flag'},{c:'🇭🇳',n:'honduras-flag'},
            {c:'🇭🇷',n:'croatia-flag'},{c:'🇭🇹',n:'haiti-flag'},{c:'🇭🇺',n:'hungary-flag'},{c:'🇮🇨',n:'canary-islands-flag'},{c:'🇮🇩',n:'indonesia-flag'},
            {c:'🇮🇪',n:'ireland-flag'},{c:'🇮🇱',n:'israel-flag'},{c:'🇮🇲',n:'isle-of-man-flag'},{c:'🇮🇳',n:'india-flag'},{c:'🇮🇴',n:'british-indian-ocean-territory-flag'},
            {c:'🇮🇶',n:'iraq-flag'},{c:'🇮🇷',n:'iran-flag'},{c:'🇮🇸',n:'iceland-flag'},{c:'🇯🇪',n:'jersey-flag'},{c:'🇯🇲',n:'jamaica-flag'},
            {c:'🇯🇴',n:'jordan-flag'},{c:'🇰🇪',n:'kenya-flag'},{c:'🇰🇬',n:'kyrgyzstan-flag'},{c:'🇰🇭',n:'cambodia-flag'},{c:'🇰🇮',n:'kiribati-flag'},
            {c:'🇰🇲',n:'comoros-flag'},{c:'🇰🇳',n:'st.-kitts-<span-class="entity"><span>&amp;</span>amp;</span>-nevis-flag'},{c:'🇰🇵',n:'north-korea-flag'},{c:'🇰🇼',n:'kuwait-flag'},{c:'🇰🇾',n:'cayman-islands-flag'},
            {c:'🇰🇿',n:'kazakhstan-flag'},{c:'🇱🇦',n:'laos-flag'},{c:'🇱🇧',n:'lebanon-flag'},{c:'🇱🇨',n:'st.-lucia-flag'},{c:'🇱🇮',n:'liechtenstein-flag'},
            {c:'🇱🇰',n:'sri-lanka-flag'},{c:'🇱🇷',n:'liberia-flag'},{c:'🇱🇸',n:'lesotho-flag'},{c:'🇱🇹',n:'lithuania-flag'},{c:'🇱🇺',n:'luxembourg-flag'},
            {c:'🇱🇻',n:'latvia-flag'},{c:'🇱🇾',n:'libya-flag'},{c:'🇲🇦',n:'morocco-flag'},{c:'🇲🇨',n:'monaco-flag'},{c:'🇲🇩',n:'moldova-flag'},
            {c:'🇲🇪',n:'montenegro-flag'},{c:'🇲🇫',n:'st.-martin-flag'},{c:'🇲🇬',n:'madagascar-flag'},{c:'🇲🇭',n:'marshall-islands-flag'},{c:'🇲🇰',n:'north-macedonia-flag'},
            {c:'🇲🇱',n:'mali-flag'},{c:'🇲🇲',n:'myanmar-flag'},{c:'🇲🇳',n:'mongolia-flag'},{c:'🇲🇴',n:'macao-sar-china-flag'},{c:'🇲🇵',n:'northern-mariana-islands-flag'},
            {c:'🇲🇶',n:'martinique-flag'},{c:'🇲🇷',n:'mauritania-flag'},{c:'🇲🇸',n:'montserrat-flag'},{c:'🇲🇹',n:'malta-flag'},{c:'🇲🇺',n:'mauritius-flag'},
            {c:'🇲🇻',n:'maldives-flag'},{c:'🇲🇼',n:'malawi-flag'},{c:'🇲🇽',n:'mexico-flag'},{c:'🇲🇾',n:'malaysia-flag'},{c:'🇲🇿',n:'mozambique-flag'},
            {c:'🇳🇦',n:'namibia-flag'},{c:'🇳🇨',n:'new-caledonia-flag'},{c:'🇳🇪',n:'niger-republic-flag'},{c:'🇳🇬',n:'nigeria-flag'},{c:'🇳🇫',n:'norfolk-island-flag'},
            {c:'🇳🇮',n:'nicaragua-flag'},{c:'🇳🇱',n:'netherlands-flag'},{c:'🇳🇴',n:'norway-flag'},{c:'🇳🇵',n:'nepal-flag'},{c:'🇳🇷',n:'nauru-flag'},
            {c:'🇳🇺',n:'niue-flag'},{c:'🇳🇿',n:'new-zealand-flag'},{c:'🇴🇲',n:'oman-flag'},{c:'🇵🇦',n:'panama-flag'},{c:'🇵🇪',n:'peru-flag'},
            {c:'🇵🇫',n:'french-polynesia-flag'},{c:'🇵🇬',n:'papua-new-guinea-flag'},{c:'🇵🇭',n:'philippines-flag'},{c:'🇵🇰',n:'pakistan-flag'},{c:'🇵🇱',n:'poland-flag'},
            {c:'🇵🇲',n:'st.-pierre-<span-class="entity"><span>&amp;</span>amp;</span>-miquelon-flag'},{c:'🇵🇳',n:'itcairn-islands-flag'},{c:'🇵🇷',n:'puerto-rico-flag'},{c:'🇵🇸',n:'palestinian-territories-flag'},{c:'🇵🇹',n:'portugal-flag'},
            {c:'🇵🇼',n:'palau-flag'},{c:'🇵🇾',n:'paraguay-flag'},{c:'🇶🇦',n:'qatar-flag'},{c:'🇷🇪',n:'réunion-flag'},{c:'🇷🇴',n:'romania-flag'},
            {c:'🇷🇸',n:'serbia-flag'},{c:'🇷🇼',n:'rwanda-flag'},{c:'🇸🇦',n:'saudi-arabia-flag'},{c:'🇸🇧',n:'solomon-islands-flag'},{c:'🇸🇨',n:'seychelles-flag'},
            {c:'🇸🇩',n:'sudan-flag'},{c:'🇸🇪',n:'sweden-flag'},{c:'🇸🇬',n:'singapore-flag'},{c:'🇸🇭',n:'st.-helena-flag'},{c:'🇸🇮',n:'slovenia-flag'},
            {c:'🇸🇯',n:'svalbard-<span-class="entity"><span>&amp;</span>amp;</span>-jan-mayen-flag'},{c:'🇸🇰',n:'slovakia-flag'},{c:'🇸🇱',n:'sierra-leone-flag'},{c:'🇸🇲',n:'san-marino-flag'},{c:'🇸🇳',n:'senegal-flag'},
            {c:'🇸🇴',n:'somalia-flag'},{c:'🇸🇷',n:'suriname-flag'},{c:'🇸🇸',n:'south-sudan-flag'},{c:'🇸🇹',n:'são-tomé-<span-class="entity"><span>&amp;</span>amp;</span>-príncipe-flag'},{c:'🇸🇻',n:'el-salvador-flag'},
            {c:'🇸🇽',n:'saint-maarten-flag'},{c:'🇸🇾',n:'syria-flag'},{c:'🇸🇿',n:'eswatini-flag'},{c:'🇹🇦',n:'tristan-da-cunha-flag'},{c:'🇹🇨',n:'turks-<span-class="entity"><span>&amp;</span>amp;</span>-caicos-islands-flag'},
            {c:'🇹🇩',n:'chad-flag'},{c:'🇹🇫',n:'french-southern-territories-flag'},{c:'🇹🇬',n:'togo-flag'},{c:'🇹🇯',n:'tajikistan-flag'},{c:'🇹🇰',n:'tokelau-flag'},
            {c:'🇹🇱',n:'timor-leste-flag'},{c:'🇹🇲',n:'turkmenistan-flag'},{c:'🇹🇳',n:'tunisia-flag'},{c:'🇹🇴',n:'tonga-flag'},{c:'🇹🇷',n:'turkey-flag'},
            {c:'🇹🇹',n:'trinidad-<span-class="entity"><span>&amp;</span>amp;</span>-tobago-flag'},{c:'🇹🇻',n:'tuvalu-flag'},{c:'🇹🇼',n:'taiwan-flag'},{c:'🇹🇿',n:'tanzania-flag'},{c:'🇺🇦',n:'ukraine-flag'},
            {c:'🇺🇬',n:'uganda-flag'},{c:'🇺🇲',n:'u.s.-outlying-islands-flag'},{c:'🇺🇳',n:'united-nations-flag'},{c:'🇺🇾',n:'uruguay-flag'},{c:'🇺🇿',n:'uzbekistan-flag'},
            {c:'🇻🇦',n:'vatican-city-flag'},{c:'🇻🇨',n:'st.-vincent-<span-class="entity"><span>&amp;</span>amp;</span>-grenadines-flag'},{c:'🇻🇪',n:'venezuela-flag'},{c:'🇻🇬',n:'british-virgin-islands-flag'},{c:'🇻🇮',n:'u.s.-virgin-islands-flag'},
            {c:'🇻🇳',n:'vietnam-flag'},{c:'🇻🇺',n:'vanuatu-flag'},{c:'🇼🇫',n:'wallis-<span-class="entity"><span>&amp;</span>amp;</span>-futuna-flag'},{c:'🇼🇸',n:'samoa-flag'},{c:'🇽🇰',n:'kosovo-flag'},
            {c:'🇾🇪',n:'yemen-flag'},{c:'🇾🇹',n:'mayotte-flag'},{c:'🇿🇦',n:'south-africa-flag'},{c:'🇿🇲',n:'zambia-flag'},{c:'🇿🇼',n:'zimbabwe-flag'},
            {c:'🏴󠁧󠁢󠁥󠁮󠁧󠁿',n:'england-flag'},{c:'🏴󠁧󠁢󠁳󠁣󠁴󠁿',n:'scotland-flag'},{c:'🏴󠁧󠁢󠁷󠁬󠁳󠁿',n:'wales-flag'}
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
                <input type="text" class="emoji-search" placeholder="Search 1800+ emojis...">
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

    closePicker: function() {
        this.pickerElement.style.display = 'none';
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
