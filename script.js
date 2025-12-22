import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import tableMatImage from "./table.png";

// SECTION constants
const candleRadius = 0.35;
const candleHeight = 3.5;
const candleCount = 5;

const baseRadius = 2.5;
const baseHeight = 2;
const middleRadius = 2;
const middleHeight = 1.25;
const topRadius = 1.5;
const topHeight = 1;

const tableHeightOffset = 1;
const BLOW_THRESHOLD = 0.2; // Sound intensity threshold for blowing
const BLOW_DURATION = 500; // Required duration for blow detection (milliseconds)

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
camera.position.set(3, 5, 8).setLength(15);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x101005);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Orbit controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.minPolarAngle = THREE.MathUtils.degToRad(60);
controls.maxPolarAngle = THREE.MathUtils.degToRad(95);
controls.minDistance = 4;
controls.maxDistance = 20;
controls.autoRotate = true;
controls.autoRotateSpeed = 1;
controls.target.set(0, 2, 0);
controls.update();

// Lighting
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.025);
directionalLight.position.setScalar(10);
scene.add(directionalLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.05));

// Audio context for blow detection
let audioContext;
let analyser;
let microphone;
let isBlowing = false;
let blowStartTime = 0;
let isAudioEnabled = false;

// Initialize audio for blow detection
async function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } 
        });
        
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        isAudioEnabled = true;
        
        console.log('Audio initialized for blow detection');
        startBlowDetection();
    } catch (error) {
        console.error('Error initializing audio:', error);
        document.getElementById('hold-reminder').innerHTML += '<br>(Microphone access denied - using touch only)';
    }
}

// Detect blowing sound
function startBlowDetection() {
    if (!isAudioEnabled) return;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function analyzeAudio() {
        if (!analyser) return;
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume in low frequencies (blowing sound)
        let sum = 0;
        const lowFreqCount = 10; // Focus on low frequencies for blow detection
        for (let i = 0; i < lowFreqCount; i++) {
            sum += dataArray[i];
        }
        const averageVolume = sum / lowFreqCount / 255;
        
        // Check if user is blowing
        if (averageVolume > BLOW_THRESHOLD) {
            if (!isBlowing) {
                isBlowing = true;
                blowStartTime = Date.now();
            } else {
                const blowDuration = Date.now() - blowStartTime;
                if (blowDuration > BLOW_DURATION) {
                    blowOutCandles();
                    isBlowing = false;
                }
            }
        } else {
            isBlowing = false;
        }
        
        requestAnimationFrame(analyzeAudio);
    }
    
    analyzeAudio();
}

// Flame material shader
function getFlameMaterial(isFrontSide) {
    const side = isFrontSide ? THREE.FrontSide : THREE.BackSide;
    return new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            isExtinguished: { value: 0 }
        },
        vertexShader: `
uniform float time;
uniform float isExtinguished;
varying vec2 vUv;
varying float hValue;

float random(in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float noise(in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    
    vec2 u = f*f*(3.0-2.0*f);
    
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Reduce flame effect when extinguished
    float flameStrength = 1.0 - isExtinguished * 0.8;
    
    pos *= vec3(0.8, 2.0 * flameStrength, 0.725);
    hValue = position.y;
    
    float posXZlen = length(position.xz);
    pos.y *= 1.0 + (cos((posXZlen + 0.25) * 3.1415926) * 0.25 + 
                   noise(vec2(0.0, time)) * 0.125 + 
                   noise(vec2(position.x + time, position.z + time)) * 0.5) * 
                   position.y * flameStrength;
    
    pos.x += noise(vec2(time * 2.0, (position.y - time) * 4.0)) * hValue * 0.0312 * flameStrength;
    pos.z += noise(vec2((position.y - time) * 4.0, time * 2.0)) * hValue * 0.0312 * flameStrength;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`,
        fragmentShader: `
varying float hValue;
varying vec2 vUv;

vec3 heatmapGradient(float t) {
    return clamp((pow(t, 1.5) * 0.8 + 0.2) * vec3(
        smoothstep(0.0, 0.35, t) + t * 0.5,
        smoothstep(0.5, 1.0, t),
        max(1.0 - t * 1.7, t * 7.0 - 6.0)
    ), 0.0, 1.0);
}

void main() {
    float v = abs(smoothstep(0.0, 0.4, hValue) - 1.0);
    float alpha = (1.0 - v) * 0.99;
    alpha -= 1.0 - smoothstep(1.0, 0.97, hValue);
    
    vec3 flameColor = heatmapGradient(smoothstep(0.0, 0.3, hValue)) * vec3(0.95, 0.95, 0.4);
    flameColor = mix(vec3(0.0, 0.0, 1.0), flameColor, smoothstep(0.0, 0.3, hValue));
    flameColor += vec3(1.0, 0.9, 0.5) * (1.25 - vUv.y);
    flameColor = mix(flameColor, vec3(0.66, 0.32, 0.03), smoothstep(0.95, 1.0, hValue));
    
    gl_FragColor = vec4(flameColor, alpha);
}
`,
        transparent: true,
        side: side
    });
}

const flameMaterials = [];

function createFlame() {
    const flameGeo = new THREE.SphereGeometry(0.5, 32, 32);
    flameGeo.translate(0, 0.5, 0);
    const flameMat = getFlameMaterial(true);
    flameMaterials.push(flameMat);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(0.06, candleHeight, 0.06);
    flame.rotation.y = THREE.MathUtils.degToRad(-45);
    return flame;
}

// Smoke particle system for extinguished candles
function createSmokeParticles() {
    const particleCount = 30;
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        // Random positions around the candle wick
        positions[i3] = (Math.random() - 0.5) * 0.3;
        positions[i3 + 1] = Math.random() * 0.5;
        positions[i3 + 2] = (Math.random() - 0.5) * 0.3;
        
        // Gray to light gray colors for smoke
        const grayValue = 0.3 + Math.random() * 0.3;
        colors[i3] = grayValue;
        colors[i3 + 1] = grayValue;
        colors[i3 + 2] = grayValue;
        
        // Random sizes
        sizes[i] = Math.random() * 0.3 + 0.1;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particles.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const smokeMaterial = new THREE.PointsMaterial({
        size: 0.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const smoke = new THREE.Points(particles, smokeMaterial);
    smoke.visible = false;
    
    return smoke;
}

// Create candle body
function createCandle() {
    const casePath = new THREE.Path();
    casePath.moveTo(0, 0);
    casePath.lineTo(0, 0);
    casePath.absarc(0, 0, candleRadius, Math.PI * 1.5, Math.PI * 2);
    casePath.lineTo(candleRadius, candleHeight);
    
    const caseGeo = new THREE.LatheGeometry(casePath.getPoints(), 64);
    const caseMat = new THREE.MeshStandardMaterial({ color: 0xff4500 });
    const caseMesh = new THREE.Mesh(caseGeo, caseMat);
    caseMesh.castShadow = true;
    
    // Candle top
    const topGeometry = new THREE.CylinderGeometry(0.2, candleRadius, 0.1, 32);
    const topMaterial = new THREE.MeshStandardMaterial({ color: 0xff4500 });
    const topMesh = new THREE.Mesh(topGeometry, topMaterial);
    topMesh.position.y = candleHeight;
    caseMesh.add(topMesh);
    
    // Candle wick
    const candlewickProfile = new THREE.Shape();
    candlewickProfile.absarc(0, 0, 0.0625, 0, Math.PI * 2);
    
    const candlewickCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, candleHeight - 1, 0),
        new THREE.Vector3(0, candleHeight - 0.5, -0.0625),
        new THREE.Vector3(0.25, candleHeight - 0.5, 0.125)
    ]);
    
    const candlewickGeo = new THREE.ExtrudeGeometry(candlewickProfile, {
        steps: 8,
        bevelEnabled: false,
        extrudePath: candlewickCurve
    });
    
    const colors = [];
    const color1 = new THREE.Color("black");
    const color2 = new THREE.Color(0x994411);
    const color3 = new THREE.Color(0xffff44);
    
    for (let i = 0; i < candlewickGeo.attributes.position.count; i++) {
        if (candlewickGeo.attributes.position.getY(i) < 0.4) {
            color1.toArray(colors, i * 3);
        } else {
            color2.toArray(colors, i * 3);
        }
        if (candlewickGeo.attributes.position.getY(i) < 0.15) {
            color3.toArray(colors, i * 3);
        }
    }
    
    candlewickGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    candlewickGeo.translate(0, 0.95, 0);
    const candlewickMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const candlewickMesh = new THREE.Mesh(candlewickGeo, candlewickMat);
    caseMesh.add(candlewickMesh);
    
    // Add smoke particles to candle
    const smoke = createSmokeParticles();
    smoke.position.y = candleHeight + 0.3;
    caseMesh.add(smoke);
    
    return caseMesh;
}

const candleTemplate = createCandle();

// Candle lights
function addCandleLights(candle) {
    const candleLight = new THREE.PointLight(0xffaa33, 1, 5, 2);
    candleLight.position.set(0, candleHeight, 0);
    candleLight.castShadow = true;
    candle.add(candleLight);
    
    const candleLight2 = new THREE.PointLight(0xffaa33, 1, 10, 2);
    candleLight2.position.set(0, candleHeight + 1, 0);
    candleLight2.castShadow = true;
    candle.add(candleLight2);
    
    return [candleLight, candleLight2];
}

// Table
const tableGeo = new THREE.CylinderGeometry(14, 14, 0.5, 64);
tableGeo.translate(0, -tableHeightOffset, 0);
const textureLoader = new THREE.TextureLoader();
const tableTexture = textureLoader.load(tableMatImage);
const tableMat = new THREE.MeshStandardMaterial({ map: tableTexture, metalness: 0, roughness: 0.75 });
const tableMesh = new THREE.Mesh(tableGeo, tableMat);
tableMesh.receiveShadow = true;
scene.add(tableMesh);

// Cake creation
function createCake() {
    const cakeGroup = new THREE.Group();
    
    // Base layer
    const baseGeometry = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 32);
    const baseMaterial = new THREE.MeshPhongMaterial({ color: 0xfff5ee });
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    baseMesh.castShadow = true;
    
    // Middle layer
    const middleGeometry = new THREE.CylinderGeometry(middleRadius, middleRadius, middleHeight, 32);
    const middleMaterial = new THREE.MeshPhongMaterial({ color: 0xfffafa });
    const middleMesh = new THREE.Mesh(middleGeometry, middleMaterial);
    middleMesh.position.y = baseHeight / 2 + middleHeight / 2;
    middleMesh.castShadow = true;
    
    // Top layer
    const topGeometry = new THREE.CylinderGeometry(topRadius, topRadius, topHeight, 32);
    const topMaterial = new THREE.MeshPhongMaterial({ color: 0xf0ffff });
    const topMesh = new THREE.Mesh(topGeometry, topMaterial);
    topMesh.position.y = baseHeight / 2 + middleHeight + topHeight / 2;
    topMesh.castShadow = true;
    
    cakeGroup.add(baseMesh);
    cakeGroup.add(middleMesh);
    cakeGroup.add(topMesh);
    
    return cakeGroup;
}

const cake = createCake();
scene.add(cake);

// Create multiple candles
const candles = new THREE.Group();
const extinguishedCandles = new Set();

function createCandles(count) {
    const radius = 1;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const candle = candleTemplate.clone();
        
        // Scale and position
        candle.scale.set(0.3, 0.3, 0.3);
        candle.position.x = Math.cos(angle) * radius;
        candle.position.z = Math.sin(angle) * radius;
        candle.position.y = baseHeight / 2 + middleHeight + topHeight;
        
        // Add lights
        const lights = addCandleLights(candle);
        
        // Add flames
        const flame1 = createFlame();
        const flame2 = createFlame();
        candle.add(flame1);
        candle.add(flame2);
        
        // Find smoke particles in the cloned candle
        let smoke = null;
        candle.children.forEach(child => {
            if (child.type === 'Points') {
                smoke = child;
            }
        });
        
        // Store references for later access
        candle.userData = {
            lights: lights,
            flames: [flame1, flame2],
            flameMaterials: [flame1.material, flame2.material],
            smoke: smoke,
            isExtinguished: false,
            smokeActive: false,
            smokeTime: 0
        };
        
        candles.add(candle);
    }
    return candles;
}

const allCandles = createCandles(candleCount);
cake.add(allCandles);

// Ambient light for the scene
const ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
scene.add(ambientLight);

// Adjust camera
camera.position.set(0, 5, 10);
camera.lookAt(cake.position);

// Hold event variables
let holdTimeout;
let allowBlowout = false;
const holdReminder = document.getElementById('hold-reminder');
const audio = document.getElementById("happy-birthday-audio");

// Enable blowout after song plays
audio.addEventListener('ended', function() {
    holdReminder.style.display = 'flex';
    setTimeout(function() {
        holdReminder.classList.add('show');
        // Initialize audio for blow detection
        initAudio();
    }, 10);
    allowBlowout = true;
});

// Hold events
function handleHoldStart() {
    if (!allowBlowout) return;
    holdTimeout = setTimeout(() => {
        blowOutCandles();
    }, 500);
}

function handleHoldEnd() {
    clearTimeout(holdTimeout);
}

document.addEventListener('mousedown', handleHoldStart);
document.addEventListener('touchstart', handleHoldStart);
document.addEventListener('mouseup', handleHoldEnd);
document.addEventListener('touchend', handleHoldEnd);

// Congratulation overlay
function showCongratulation() {
    const overlay = document.getElementById('congratulation-overlay');
    overlay.style.pointerEvents = 'auto';
    overlay.style.background = 'rgba(0, 0, 0, 0.8)';
    overlay.style.opacity = '1';
}

// Update smoke animation for a candle
function updateSmokeAnimation(candle, deltaTime) {
    if (!candle.userData.smokeActive || !candle.userData.smoke) return;
    
    const smoke = candle.userData.smoke;
    const positions = smoke.geometry.attributes.position.array;
    const colors = smoke.geometry.attributes.color.array;
    
    candle.userData.smokeTime += deltaTime;
    
    for (let i = 0; i < positions.length / 3; i++) {
        const i3 = i * 3;
        
        // Update position - smoke rises and spreads
        positions[i3 + 1] += deltaTime * 0.5; // Rise
        positions[i3] += (Math.random() - 0.5) * deltaTime * 0.1; // Spread horizontally
        positions[i3 + 2] += (Math.random() - 0.5) * deltaTime * 0.1;
        
        // Fade out over time
        const age = candle.userData.smokeTime;
        const fadeStart = 2.0;
        const fadeDuration = 1.0;
        
        if (age > fadeStart) {
            const fadeAmount = Math.min(1.0, (age - fadeStart) / fadeDuration);
            colors[i3] *= (1 - fadeAmount * 0.1);
            colors[i3 + 1] *= (1 - fadeAmount * 0.1);
            colors[i3 + 2] *= (1 - fadeAmount * 0.1);
        }
        
        // Reset particle if it goes too high
        if (positions[i3 + 1] > 2.0) {
            positions[i3] = (Math.random() - 0.5) * 0.3;
            positions[i3 + 1] = Math.random() * 0.5;
            positions[i3 + 2] = (Math.random() - 0.5) * 0.3;
            
            // Reset color
            const grayValue = 0.3 + Math.random() * 0.3;
            colors[i3] = grayValue;
            colors[i3 + 1] = grayValue;
            colors[i3 + 2] = grayValue;
        }
    }
    
    smoke.geometry.attributes.position.needsUpdate = true;
    smoke.geometry.attributes.color.needsUpdate = true;
    
    // Stop smoke after some time
    if (candle.userData.smokeTime > 10) {
        candle.userData.smokeActive = false;
        smoke.visible = false;
    }
}

// Activate smoke for a candle
function activateSmoke(candle) {
    if (!candle.userData.smoke) return;
    
    candle.userData.smokeActive = true;
    candle.userData.smokeTime = 0;
    candle.userData.smoke.visible = true;
    
    // Reset particle positions
    const smoke = candle.userData.smoke;
    const positions = smoke.geometry.attributes.position.array;
    const colors = smoke.geometry.attributes.color.array;
    
    for (let i = 0; i < positions.length / 3; i++) {
        const i3 = i * 3;
        positions[i3] = (Math.random() - 0.5) * 0.3;
        positions[i3 + 1] = Math.random() * 0.5;
        positions[i3 + 2] = (Math.random() - 0.5) * 0.3;
        
        const grayValue = 0.3 + Math.random() * 0.3;
        colors[i3] = grayValue;
        colors[i3 + 1] = grayValue;
        colors[i3 + 2] = grayValue;
    }
    
    smoke.geometry.attributes.position.needsUpdate = true;
    smoke.geometry.attributes.color.needsUpdate = true;
}

// Extinguish single candle
function extinguishCandle(candle, speed) {
    if (candle.userData.isExtinguished) return;
    
    candle.userData.isExtinguished = true;
    extinguishedCandles.add(candle);
    
    const lights = candle.userData.lights;
    const flames = candle.userData.flames;
    const flameMats = candle.userData.flameMaterials;
    
    let progress = 0;
    const extinguishInterval = setInterval(() => {
        progress += 0.02 * speed;
        
        if (progress >= 1) {
            clearInterval(extinguishInterval);
            flames.forEach(flame => {
                flame.visible = false;
            });
            lights.forEach(light => {
                light.intensity = 0;
            });
            // Activate smoke after flame is extinguished
            setTimeout(() => {
                activateSmoke(candle);
            }, 100);
        } else {
            // Animate flame extinguishing
            flames.forEach((flame, index) => {
                flame.material.opacity = 1 - progress;
                flame.material.uniforms.isExtinguished.value = progress;
                flame.scale.setScalar(1 - progress * 0.7);
            });
            
            // Reduce light intensity
            lights.forEach(light => {
                light.intensity = Math.max(0, 1 - progress);
            });
        }
    }, 30);
}

// Blow out all candles
function blowOutCandles() {
    if (extinguishedCandles.size >= candleCount) return;
    
    const blowSound = new Audio('/blow-sound.mp3');
    blowSound.volume = 0.5;
    blowSound.play().catch(e => console.log('Blow sound not available'));
    
    allCandles.children.forEach(candle => {
        if (!candle.userData.isExtinguished) {
            const speed = 1 + Math.random() * 3;
            extinguishCandle(candle, speed);
        }
    });
    
    // Gradually increase ambient light
    let ambientLightIntensity = ambientLight.intensity;
    const ambientInterval = setInterval(() => {
        ambientLightIntensity += 0.01;
        if (ambientLightIntensity >= 0.1) {
            clearInterval(ambientInterval);
            ambientLight.intensity = 0.1;
            showCongratulation();
        } else {
            ambientLight.intensity = ambientLightIntensity;
        }
    }, 50);
    
    // Hide reminder
    holdReminder.style.display = 'none';
    
    // Stop audio analysis
    if (microphone) {
        microphone.disconnect();
    }
}

// Animation loop
const clock = new THREE.Clock();
let time = 0;

function render() {
    requestAnimationFrame(render);
    const deltaTime = clock.getDelta();
    time += deltaTime;
    
    // Update flame materials
    flameMaterials.forEach((material, index) => {
        if (material.uniforms && material.uniforms.time) {
            material.uniforms.time.value = time;
        }
    });
    
    // Update candle lights animation
    allCandles.children.forEach(candle => {
        if (!candle.userData.isExtinguished && candle.userData.lights && candle.userData.lights[1]) {
            const light = candle.userData.lights[1];
            light.position.x = Math.sin(time * Math.PI) * 0.25;
            light.position.z = Math.cos(time * Math.PI * 0.75) * 0.25;
            light.intensity = 2 + Math.sin(time * Math.PI * 2) * Math.cos(time * Math.PI * 1.5) * 0.25;
        }
        
        // Update smoke animation for extinguished candles
        if (candle.userData.isExtinguished) {
            updateSmokeAnimation(candle, deltaTime);
        }
    });
    
    controls.update();
    renderer.render(scene, camera);
}

render();

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize
console.log('Birthday cake scene initialized');