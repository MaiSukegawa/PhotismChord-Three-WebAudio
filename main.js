const baseCanvas = document.createElement('canvas'), 
      baseCanvasCtx = baseCanvas.getContext('2d');

let   video, media;
let   renderer, scene, camera, container;
let   pillarGeo, pillarMat, pillarMesh;

const pillarNum = 32,   // 2^n
      pillarSize = window.innerWidth / pillarNum,
      pillarColRGB = [...Array(pillarNum)].map(() => 'rgb(0, 0, 0)'),
      pillarColHSL = [...Array(pillarNum)].map(() => ({ h: 0, s: 0, l: 0 })),
      pillarFilterVal = [...Array(pillarNum)].map(() => ({ cf: 0, q: 0, gain: 0 }));

const rgbMax = 255,
      hueMax = 360,
      saturationMax = 100,
      lightnessMax = 100;
let   hue, saturation, lightness;

const threeConst = {
      // Camera attribute
      fov:        45,
      aspect:     window.innerWidth / window.innerHeight,
      near:       0.1,
      far:        10000,
      bgColor:    0x000000,

      cameraX:    0,
      cameraY:    0,
      cameraZ:    100,

      objColor:   new THREE.Color()
}

// 12-TET set
const octave = 7,
      notes = 12,
      aFreq = 440,
      semitone = Math.pow(2, 1/12),
      fundFreq = new Array(notes).fill(0),
      qRange = 60;

// Filter set
const hueRange = hueMax / notes,    // 30
      hueSplit = new Array(notes).fill(0);

let   redTone;
let   cfBase, cfOct, cf, q, gainBase, gain;
let   irBuffer;

let   audioCtx,
      sampleRate,
      grainSourceNode = new Array(pillarNum),
      lpFilterNode = new Array(pillarNum),
      bpFilterNode = new Array(pillarNum),
      gainNode = new Array(pillarNum),
      stPannerNode = new Array(pillarNum),
      splitterNode = new Array(pillarNum),
      mergerNode,
      particleRevNode;

// Rendering clock set
const delaySec = 1.8,           // Set lengthMaxSec + delayMinSec from worklet script
      scheduleAheadSec = 0.1,
      checkInterval = 25,       // Millisecond
      renderInterval = 1 / 25;  // Second
let   nextFrameSec = 0,
      renderedCount = 0,
      delayCount = Math.floor(delaySec / renderInterval);

const pillarColRGB_delay = new Array(delayCount),
      pillarColHSL_delay = new Array(delayCount);

// DOCUMENT SETTING =======================================================================

// Set fullscreen -------------------------------------------------------------------------
function onResize() {
    // Adjust renderer size
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    createPillars();

    // Adjust camera aspect ratio
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    console.log("Screen size changed.")
}

// Detect resize event
window.addEventListener('resize', onResize);

// Show alert message ---------------------------------------------------------------------
function alert() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('alert').classList.remove('deleted');
}

// Wait for page to load ------------------------------------------------------------------
window.addEventListener('load', init);


// INITIALISATION =========================================================================

function init() {
    // Start user's webcam and pass the stream to video element
    initWebcam();

    // Create visual environment
    initThreeEnv();

    video.addEventListener('play', function() {
        console.log("Video has started playing.");

        // Delete loading sign
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('start').classList.remove('hidden');
        document.getElementById('start').addEventListener('click', onClick);
    });
}

async function onClick() {
    console.log("Button clicked.");

    // Create audio environment
    await initAudio();

    // Delete title
    document.getElementById('title').classList.add('hidden');
    document.getElementById('start').classList.add('hidden');

    audioCtx.resume();
    // render();
    setInterval(scheduler, checkInterval);
}

// VISUAL =================================================================================

// Start webcam ---------------------------------------------------------------------------
function initWebcam() {
    video = document.createElement('video');
    video.autoplay = true;

    media = navigator.mediaDevices;
    const constraints = {
        video: true,
        audio: false
    }
    media.getUserMedia(constraints)
    .then(function(stream) {
        console.log("Camera access allowed.")
        video.srcObject = stream;
    })
    .catch(function(error) {
        console.log("Camera access denied.");
        alert();
    });
}

// Form the image of baseCanvas into a mosaic ---------------------------------------------
function createMosaic() {
    // console.log("Forming a mosaic!");

    baseCanvas.width = video.videoWidth;
    baseCanvas.height = video.videoWidth / pillarNum;

    // Flip the canvas
    baseCanvasCtx.translate(baseCanvas.width / 2, baseCanvas.height / 2);
    baseCanvasCtx.rotate(Math.PI);
    baseCanvasCtx.translate(-baseCanvas.width / 2, -baseCanvas.height / 2);

    // Trim video image and draw it on the canvas
    baseCanvasCtx.drawImage(
        video,
        0,
        video.videoHeight / 2 - video.videoWidth / pillarNum / 2,
        video.videoWidth,
        video.videoWidth / pillarNum,
        0,
        0,
        baseCanvas.width,
        baseCanvas.height,
    );

    const imageData = baseCanvasCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height),
          mosaicSize = baseCanvas.height;

    // Retrieve colour data from each piece of mosaic
    let i = 0;
    for (let x = 0; x < baseCanvas.width; x += mosaicSize) {
        let r = imageData.data[x * 4];
        let g = imageData.data[x * 4 + 1];
        let b = imageData.data[x * 4 + 2];
        pillarColRGB[i] = `rgb(${r}, ${g}, ${b})`;

        RGBtoHSL(r, g, b);
        pillarColHSL[i] = { h: hue, s: saturation, l: lightness };
        i++;
    }

    pillarColRGB_delay[renderedCount % delayCount] = pillarColRGB;
    pillarColHSL_delay[renderedCount % delayCount] = pillarColHSL;
}

// Convert RGB to HSL ---------------------------------------------------------------------
function RGBtoHSL(r, g, b) {
    r /= rgbMax;
    g /= rgbMax;
    b /= rgbMax;

    let max = Math.max(r, g, b);
    let min = Math.min(r, g, b);
    let delta = max - min;

    // Hue
    if (delta == 0) {
        hue = 0;
    } else if (r == max) {
        hue = ((g - b) / delta);
    } else if (g == max) {
        hue = (b - r) / delta + 2;
    } else {
        hue = (r - g) / delta + 4;
    }

    hue = Math.round(hue * 60);

    if (hue < 0) {
        hue += hueMax;
    }

    // Lightness
    lightness = (max + min) / 2;
    lightness = Math.round(lightness * lightnessMax);

    // Saturation
    if (delta == 0) {
        saturation = 0;
    } else {
        saturation = delta / (1 - Math.abs(2 * lightness - 1));
    }

    saturation = Math.round(saturation * saturationMax);

    let coefA = (saturation - (saturationMax * 0.2)) / (lightness ** 2),
        coefB = saturationMax * 0.2;

    if (lightness < lightnessMax / 2) {
        saturation = coefA * (lightness ** 2) + coefB;
    } else {
        saturation = coefA * ((lightness - lightnessMax) ** 2) + coefB;
    }
}

// Three.js -------------------------------------------------------------------------------
function initThreeEnv() {
    // Renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('content').appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(threeConst.bgColor);
    scene.fog = new THREE.Fog(threeConst.bgColor, threeConst.near, threeConst.far);

    // Camera
    camera = new THREE.OrthographicCamera(
        window.innerWidth  / -2,
        window.innerWidth  /  2,
        window.innerHeight /  2,
        window.innerHeight / -2,
        threeConst.near,
        threeConst.far
    );
    camera.position.set(
        threeConst.cameraX, 
        threeConst.cameraY, 
        threeConst.cameraZ
    );
    scene.add(camera);
}

function createPillars() {
    // Delete existing pillars
    let obj = scene.getObjectByName('pillar');
    if (obj) {
        // console.log("Let's tidy up!");

        scene.remove(container);

        container.traverse(function() {
            obj.material.dispose();
            obj.geometry.dispose();
            container.remove(obj);
        });

        container = undefined;
        obj = undefined;

        // console.log("It's now clean!");
    }

    // Geometry
    let pillarColRGB_delayedSet = pillarColRGB_delay[(renderedCount - delayCount) % delayCount],
        pillarColHSL_delayedSet = pillarColHSL_delay[(renderedCount - delayCount) % delayCount];

    container = new THREE.Group();
    pillarGeo = new THREE.BoxGeometry(pillarSize, window.innerHeight, pillarSize);
    
    for (let i = 0; i < pillarNum; i++) {
        threeConst.objColor.set(pillarColRGB_delayedSet[i]);
        pillarMat = new THREE.MeshBasicMaterial({ color: threeConst.objColor });

        pillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
        pillarMesh.scale.y = pillarColHSL_delayedSet[i].s / saturationMax;
        
        let x;
        const abs = pillarNum / 2;
        if (i < abs) {
            x = pillarSize / -2 + pillarSize * (i - abs + 1);
        } else {
            x = pillarSize / 2 + pillarSize * (i - abs);
        }
        pillarMesh.position.set(x, 0, 0);

        pillarMesh.name = 'pillar';
        container.add(pillarMesh);

        // console.log("A pillar created.");
    }
    
    container.name = 'container';
    scene.add(container);
}

// AUDIO ==================================================================================

// General audio setting ------------------------------------------------------------------
async function initAudio() {
    audioCtx = new AudioContext({ sampleRate: 44100 });
    sampleRate = audioCtx.sampleRate;

    // Fill 12-TET note frequencies
    // NOTE: fundFreq[0] is "E"
    fundFreq[0] = aFreq * Math.pow(semitone, 7) / Math.pow(2, 4);
    for (let i = 1; i < fundFreq.length; i++) {
        fundFreq[i] = fundFreq[i - 1] * semitone;
    }

    // Initialise synaesthesia pattern
    setSynSpectrum();

    // Create audio nodes
    for (let i = 0; i < pillarNum; i++) {
        lpFilterNode[i] = audioCtx.createBiquadFilter();
        lpFilterNode[i].type = 'lowpass';
        lpFilterNode[i].frequency.value = 1000;
        lpFilterNode[i].Q.value = 1;


        bpFilterNode[i] = audioCtx.createBiquadFilter();
        bpFilterNode[i].type = 'bandpass';
    
        gainNode[i] = audioCtx.createGain();

        stPannerNode[i] = audioCtx.createStereoPanner();

        splitterNode[i] = audioCtx.createChannelSplitter(2);
    }

    mergerNode = audioCtx.createChannelMerger(2);

    await audioCtx.audioWorklet.addModule('worklet_particleRev.js').then(function() {
        particleRevNode = new AudioWorkletNode(audioCtx, 'particleRev');
    });
}


// Set synaesthesia scale -----------------------------------------------------------------
// NOTE: hueSplit[0] should cover "E" colour
// Spectrum / D.D.Jameson (1844) / I.J.Belmont (1944)
function setSynSpectrum() {
    const margin = hueRange / 2;    // 15

    for (let i = 0; i < hueSplit.length; i++) {
        hueSplit[i] = hueRange * (i + 4) - margin;
    }

    // Number of the pitch linked to red, counting up from "E"(0)
    redTone = 8;
}

// Granular synthesis-ish ---------------------------------------------------------------
// Generate grains linking to pillars
function createGrains() {
    // Grain length
    let grainSize = sampleRate / 30; // 44,100Hz: 1470samp | 48,000Hz: 1600samp

    for (let i = 0; i < pillarNum; i++) {
        // Buffer for a grain
        let grainBuffer = audioCtx.createBuffer(1, grainSize, sampleRate);

        // Float32Array-data of the buffer
        let grainBufferData = grainBuffer.getChannelData(0);

        // Multipily the grain with a window function
        for (let j = 0; j < grainSize; j++) {
            let sig;
            let gainRate = 0.2;

            // Window (Hann)
            // sig = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / bufferSize);

            // Window (Blackman)
            // sig = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / bufferSize)
            //            + 0.08 * Math.cos(4 * Math.PI * i / bufferSize);

            // Window (Hamming)
            sig = 0.54 - 0.46 * Math.cos(2 * Math.PI * j / grainSize);

            // Apply window to the white noise grain
            grainBufferData[j] = (Math.random() * 2 - 1) * sig * gainRate;
        }

        grainSourceNode[i] = audioCtx.createBufferSource(); // Need to be made every time
        grainSourceNode[i].buffer = grainBuffer;
        grainSourceNode[i].loop = false;

        // Cut high-pitch sound
        grainSourceNode[i].connect(lpFilterNode[i]); 

        // Filter the grain according to HSL value
        HSLtoBFValue(pillarColHSL[i].h, pillarColHSL[i].s, pillarColHSL[i].l);
        pillarFilterVal[i] = { cf: cf, q: q, gain: gain }; // Probably unnecessary

        bpFilterNode[i].frequency.value = cf;
        bpFilterNode[i].Q.value = q;
        lpFilterNode[i].connect(bpFilterNode[i]);

        // Set loudness of the grain
        gainNode[i].gain.vlaue = gain;
        bpFilterNode[i].connect(gainNode[i]);

        // Pan
        let panRate = i * 2 / (pillarNum - 1) - 1; // Left: -1, Right: 1
        stPannerNode[i].pan.value = panRate;
        gainNode[i].connect(stPannerNode[i]);

        // Separate stereo into 2 monos
        stPannerNode[i].connect(splitterNode[i]);

        // Merge
        splitterNode[i].connect(mergerNode, 0, 0); // Left
        splitterNode[i].connect(mergerNode, 1, 1); // Right

        // Play
        grainSourceNode[i].start(0);
    }

    // Reverb (final process)
    mergerNode.connect(particleRevNode);
    
    // Final output    
    particleRevNode.connect(audioCtx.destination);
}

// Convert HSL values to bandpass filter values -------------------------------------------
function HSLtoBFValue(h, s, l) {
    // Hue to fundamental frequency
    let count = 0;
    for (let i = 0; i < hueSplit.length; i++) {
        if ((hueSplit[i] % hueMax) < h && h <= ((hueSplit[i] + hueRange) % hueMax)) {
            cfBase = fundFreq[i];
            break;
        }
        count++;
    }
    // Red color needs some special treatment
    if (count == 12) {
        cfBase = fundFreq[redTone];
    }

    // Q factor
    q = (s / saturationMax) * qRange + 15;

    // Lightness to pitch
    for (let i = 0; i < octave; i++) {
        if ((saturationMax * i / octave) < l && l <= (saturationMax * (i + 1) / octave)) {
            cfOct = i + 1;
            break;
        }
    }

    // Cutoff frequency
    cf = cfBase * Math.pow(2, cfOct);

    // Gain
    let sig;
    // Window (Blackman): Maximum on 3rd octave
    sig = 0.42 - 0.5 * Math.cos(2 * Math.PI * (cfOct + 1) / (2 * (octave - 3)))
                + 0.08 * Math.cos(4 * Math.PI * (cfOct + 1) / (2 * (octave - 3)));
    gain = s * s / (saturationMax * saturationMax) * sig;
}


// FINAL RENDERING ========================================================================
function render(t) {
    createMosaic();
    createGrains();

    if (renderedCount > delayCount) createPillars();

    renderer.render(scene, camera);
    
    console.log("Rendering...");

    renderedCount++;
}

function scheduler() {
    while(nextFrameSec < audioCtx.currentTime + scheduleAheadSec) {
        // Threr is a grain to be played
        render();

        // Update nextFrame time
        nextFrameSec += renderInterval;
    }
}