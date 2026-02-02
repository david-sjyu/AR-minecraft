// --- 1. 전역 변수 선언 ---
let scene, camera, renderer, controls;
let videoElement, canvasElement, canvasCtx;
let hands;
let mpCamera; 

const BLOCK_SIZE = 2.0; 
const GRID_SIZE = BLOCK_SIZE;
const blocks = []; 
let blockGroup; 

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let smoothMouse = new THREE.Vector2(); 

const startPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let wallMesh; 
const mathPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); 

const DWELL_TIME = 800; 
let hoverStartTime = 0;
let lastHoverGrid = { x: null, y: null, z: null }; 
let lastHoverObject = null;                        

let isBlockPlacedInThisHover = false;

// 모드 상태 변수
let currentMode = 'NONE'; // 'INSTALL', 'ROTATE', 'SCALE', 'PAN', 'ERASER'

let isRotating = false;
let isPanning = false; 
let isScaling = false;
let lastHandPos = { x: 0, y: 0 };
const ROTATION_SPEED = 4.0; 
const PAN_SPEED = 40.0; 

let initialPinchDistance = 0;
let initialGroupScale = 1.0;

let camTheta = 0;           
let camPhi = Math.PI / 2;   
const CAM_RADIUS = 40;
let cameraTarget = new THREE.Vector3(0, 0, 0); 

let currentHexColor = 0xff3333; 
let isEraserMode = false; 
let isFrontCamera = true;

// --- 2. 초기화 실행 ---
window.onload = function() {
    videoElement = document.getElementsByClassName('input_video')[0];
    canvasElement = document.getElementsByClassName('output_canvas')[0];
    canvasCtx = canvasElement.getContext('2d');

    resizeCanvasToDisplaySize();

    document.getElementById('clearBtn').addEventListener('click', clearAllBlocks);
    document.getElementById('cameraBtn').addEventListener('click', toggleCamera);
    
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            swatches.forEach(s => s.classList.remove('active'));
            const target = e.target.classList.contains('color-swatch') ? e.target : e.target.parentElement;
            target.classList.add('active');
            
            if (target.id === 'eraser-btn') {
                isEraserMode = true; 
            } else {
                isEraserMode = false; 
                currentHexColor = parseInt(target.dataset.color, 16);
            }
        });
    });

    window.addEventListener('resize', onWindowResize);

    initThree();
    initMediaPipe();
};

function resizeCanvasToDisplaySize() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
}

function toggleCamera() {
    isFrontCamera = !isFrontCamera; 
    if (videoElement.srcObject) {
        const tracks = videoElement.srcObject.getTracks();
        tracks.forEach(track => track.stop());
    }
    startMediaPipeCamera();
}

// --- 3. Three.js 설정 ---
function initThree() {
    scene = new THREE.Scene();
    scene.background = null; 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
    updateCameraPosition(); 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; 
    document.getElementById('three-canvas-container').appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(10, 20, 30);
    dirLight.castShadow = true;
    scene.add(dirLight);

    blockGroup = new THREE.Group();
    scene.add(blockGroup);

    const wallGeo = new THREE.PlaneGeometry(10000, 10000);
    const wallMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }); 
    wallMesh = new THREE.Mesh(wallGeo, wallMat);
    scene.add(wallMesh);

    const cursorGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const cursor = new THREE.Mesh(cursorGeo, cursorMat);
    cursor.name = 'cursor';
    scene.add(cursor);

    loadBlocks();
    animate();
}

function saveBlocks() {
    const blockData = [];
    blockGroup.children.forEach(child => {
        if (child.name !== 'previewBlock' && child.name !== 'deletePreview') {
            blockData.push({
                x: child.position.x,
                y: child.position.y,
                z: child.position.z,
                color: child.material.color.getHex() 
            });
        }
    });
    localStorage.setItem('myARBlocks', JSON.stringify(blockData));
}

function loadBlocks() {
    const savedData = localStorage.getItem('myARBlocks');
    if (savedData) {
        const parsedData = JSON.parse(savedData);
        parsedData.forEach(data => {
            createBlock(data.x, data.y, data.z, data.color, false);
        });
    }
}

function updateCameraPosition() {
    const offsetX = CAM_RADIUS * Math.sin(camPhi) * Math.sin(camTheta);
    const offsetY = CAM_RADIUS * Math.cos(camPhi);
    const offsetZ = CAM_RADIUS * Math.sin(camPhi) * Math.cos(camTheta);

    camera.position.set(
        cameraTarget.x + offsetX, 
        cameraTarget.y + offsetY, 
        cameraTarget.z + offsetZ
    );
    
    let phiNorm = camPhi % (2 * Math.PI);
    if (phiNorm < 0) phiNorm += 2 * Math.PI;

    if (phiNorm > Math.PI && phiNorm < 2 * Math.PI) {
        camera.up.set(0, -1, 0); 
    } else {
        camera.up.set(0, 1, 0); 
    }
    camera.lookAt(cameraTarget);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeCanvasToDisplaySize();
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// [핵심] 제스처 판별 함수 (상대 거리 기반)
function detectGesture(landmarks) {
    // 1. 기준 척도 계산 (손목 ~ 중지 뿌리 거리) - 손의 크기에 따라 거리 기준을 맞추기 위함
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const handSize = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);

    // 주요 팁 포인트
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const indexMcp = landmarks[5]; // 검지 뿌리

    // 거리 계산
    const dist_Index_Middle = Math.hypot(indexTip.x - middleTip.x, indexTip.y - middleTip.y);
    const dist_Thumb_Index = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    const dist_Thumb_Middle = Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y);
    
    // 엄지 끝이 검지 뿌리(손바닥)에서 얼마나 먼가? (L자 판별용)
    const dist_Thumb_Palm = Math.hypot(thumbTip.x - indexMcp.x, thumbTip.y - indexMcp.y);

    // 기준 임계값 (손 크기에 비례)
    const CLOSE_THRESHOLD = handSize * 0.6; // 뭉쳤다고 볼 거리
    const FAR_THRESHOLD = handSize * 0.9;   // 떨어졌다고 볼 거리

    // 1. [중심 이동] 엄지, 검지, 중지가 모두 가까움 (삼발이 그립)
    if (dist_Thumb_Index < CLOSE_THRESHOLD && dist_Thumb_Middle < CLOSE_THRESHOLD && dist_Index_Middle < CLOSE_THRESHOLD) {
        return 'PAN';
    }

    // 2. [회전] 검지와 중지는 가깝고, 엄지는 멂 (검지,중지 붙임)
    // *추가 조건: 엄지까지 가까우면 PAN이 되므로, PAN이 아닐 때만 체크됨
    if (dist_Index_Middle < CLOSE_THRESHOLD) {
        return 'ROTATE';
    }

    // 3. [설치] vs [확대] (검지와 중지가 멀 때)
    if (dist_Index_Middle >= FAR_THRESHOLD) {
        // 검지와 중지가 멀다는 건 검지를 폈다는 뜻.
        // 이때 엄지의 위치로 설치/확대를 구분
        
        // 엄지 끝이 검지 뿌리에서 멀리 떨어져 있으면 'L자' -> 확대
        if (dist_Thumb_Palm > handSize * 0.8) {
            return 'SCALE';
        }
        // 엄지가 손바닥에 붙어 있으면 -> 설치
        else {
            return isEraserMode ? 'ERASER' : 'INSTALL';
        }
    }

    return 'NONE';
}

// --- 4. MediaPipe 로직 ---
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();

    const oldPreview = blockGroup.getObjectByName('previewBlock');
    if (oldPreview) blockGroup.remove(oldPreview);
    
    const oldDeletePreview = blockGroup.getObjectByName('deletePreview');
    if (oldDeletePreview) blockGroup.remove(oldDeletePreview);
    
    const cursor = scene.getObjectByName('cursor');
    if(cursor) cursor.visible = false;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks, {color: '#FF0000', lineWidth: 2});

        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        const hasBlocks = blocks.length > 0;

        // [신규] 제스처 판별
        const gesture = detectGesture(landmarks);
        currentMode = gesture; // 디버깅용

        // ----------------------------------------------------
        // 모드별 동작 실행
        // ----------------------------------------------------

        // 1. 중심 이동 (PAN) - 손가락 3개 뭉침
        if (gesture === 'PAN' && hasBlocks) {
            isRotating = false;
            isScaling = false;
            if (!isPanning) {
                isPanning = true;
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            } else {
                const deltaX = (indexTip.x - lastHandPos.x); 
                const deltaY = (indexTip.y - lastHandPos.y); 
                const camDir = new THREE.Vector3();
                camera.getWorldDirection(camDir); 
                const camRight = new THREE.Vector3();
                camRight.crossVectors(camDir, camera.up).normalize(); 
                const camUp = new THREE.Vector3().copy(camera.up).normalize();

                const dirX = isFrontCamera ? 1 : -1; // 후면 카메라 보정
                const moveX = camRight.multiplyScalar(deltaX * PAN_SPEED * dirX); 
                const moveY = camUp.multiplyScalar(deltaY * PAN_SPEED); 

                cameraTarget.add(moveX).add(moveY);
                updateCameraPosition();
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            }
            showGuideText("🖐️ 중심 이동 (세 손가락 뭉침)");
        }

        // 2. 회전 (ROTATE) - 검지, 중지 붙임
        else if (gesture === 'ROTATE' && hasBlocks) {
            isScaling = false; 
            isPanning = false;
            if (!isRotating) {
                isRotating = true;
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            } else {
                const deltaX = (indexTip.x - lastHandPos.x) * ROTATION_SPEED;
                const deltaY = (indexTip.y - lastHandPos.y) * ROTATION_SPEED;
                
                const dirX = isFrontCamera ? 1 : -1;
                camTheta += deltaX * 2 * dirX; 
                
                camPhi -= deltaY * 2;   
                updateCameraPosition();
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            }
            showGuideText("🔄 화면 회전 (검지+중지 붙임)");
        }

        // 3. 확대/축소 (SCALE) - L자 모양
        else if (gesture === 'SCALE' && hasBlocks) {
            isRotating = false; 
            isPanning = false;
            const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
            if (!isScaling) {
                isScaling = true;
                initialPinchDistance = pinchDist;
                initialGroupScale = blockGroup.scale.x;
            } else {
                const scaleFactor = pinchDist / initialPinchDistance;
                let newScale = initialGroupScale * scaleFactor;
                newScale = Math.max(0.2, Math.min(5.0, newScale));
                blockGroup.scale.set(newScale, newScale, newScale);
            }
            const percent = Math.round(blockGroup.scale.x * 100);
            showGuideText(`🔍 크기 조절: ${percent}% (L자)`);
        }

        // 4. 설치 (INSTALL) 또는 지우개 (ERASER) - 검지 하나만 (엄지는 주먹)
        else if (gesture === 'INSTALL' || gesture === 'ERASER') {
            isRotating = false;
            isScaling = false;
            isPanning = false;

            if (!hasBlocks) {
                processPlacement(indexTip, true); // 초기 설치
                showGuideText("☝️ 첫 블럭 설치");
            } else {
                processPlacement(indexTip, false);
                if (isEraserMode) showGuideText("❌ 지우개 모드");
                else showGuideText("☝️ 블럭 덧붙이기");
            }
        } 
        
        else {
            isRotating = false;
            isScaling = false;
            isPanning = false;
            if (hasBlocks) showGuideText("✋ 대기 중 (손 모양을 만드세요)");
            else showGuideText("☝️ 검지를 펴서 시작하세요");
        }
    }
}

function processPlacement(indexTip, isInitialMode) {
    let targetX, targetY;

    if (isFrontCamera) {
        targetX = ((1 - indexTip.x) * 2) - 1; 
    } else {
        targetX = (indexTip.x * 2) - 1; 
    }
    targetY = ((1 - indexTip.y) * 2) - 1; 

    smoothMouse.x += (targetX - smoothMouse.x) * 0.5;
    smoothMouse.y += (targetY - smoothMouse.y) * 0.5;

    raycaster.setFromCamera(smoothMouse, camera);

    if (isEraserMode && !isInitialMode) {
        const intersects = raycaster.intersectObjects(blockGroup.children);
        
        if (intersects.length > 0) {
            const hitBlock = intersects[0].object;
            const cursor = scene.getObjectByName('cursor');
            if(cursor) {
                cursor.visible = true;
                cursor.position.copy(intersects[0].point);
            }

            const currentTime = Date.now();
            
            if (lastHoverObject === hitBlock) {
                const elapsedTime = currentTime - hoverStartTime;
                const progress = Math.min(elapsedTime / DWELL_TIME, 1.0);

                const pixelX = indexTip.x * canvasElement.width;
                const pixelY = indexTip.y * canvasElement.height;
                let drawX = pixelX;
                
                drawLoadingRing(drawX, pixelY, progress, true); 

                const delGeo = new THREE.BoxGeometry(BLOCK_SIZE * 1.05, BLOCK_SIZE * 1.05, BLOCK_SIZE * 1.05);
                const delMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.8 });
                const delPreview = new THREE.Mesh(delGeo, delMat);
                delPreview.position.copy(hitBlock.position); 
                delPreview.name = 'deletePreview';
                blockGroup.add(delPreview);

                if (elapsedTime >= DWELL_TIME && !isBlockPlacedInThisHover) {
                    blockGroup.remove(hitBlock);
                    const index = blocks.indexOf(hitBlock);
                    if (index > -1) blocks.splice(index, 1);
                    
                    if(hitBlock.geometry) hitBlock.geometry.dispose();
                    if(hitBlock.material) hitBlock.material.dispose();

                    saveBlocks();

                    isBlockPlacedInThisHover = true; 
                    lastHoverObject = null;
                    hoverStartTime = currentTime;
                }
            } else {
                hoverStartTime = currentTime;
                lastHoverObject = hitBlock;
                isBlockPlacedInThisHover = false;
            }
        } else {
            lastHoverObject = null;
            hoverStartTime = Date.now();
        }
        return; 
    }

    let finalPoint = null;
    let finalNormal = null;

    if (isInitialMode) {
        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(startPlane, target);
        if (target) finalPoint = target;
    } else {
        const intersectObjects = [wallMesh, ...blockGroup.children];
        const intersects = raycaster.intersectObjects(intersectObjects);
        
        if (intersects.length > 0) {
            finalPoint = intersects[0].point;
            finalNormal = intersects[0].face.normal.clone();
        } else {
            const target = new THREE.Vector3();
            raycaster.ray.intersectPlane(mathPlane, target);
            if(target) {
                finalPoint = target;
                finalNormal = new THREE.Vector3(0, 0, 1);
            }
        }
    }

    if (finalPoint) {
        const cursor = scene.getObjectByName('cursor');
        if(cursor) {
            cursor.visible = true;
            cursor.position.copy(finalPoint);
        }

        let localPoint = blockGroup.worldToLocal(finalPoint.clone());

        if (!isInitialMode && finalNormal) {
            localPoint.add(finalNormal.multiplyScalar(BLOCK_SIZE / 2));
        }

        const gridX = Math.round(localPoint.x / GRID_SIZE) * GRID_SIZE;
        const gridY = Math.round(localPoint.y / GRID_SIZE) * GRID_SIZE;
        const gridZ = Math.round(localPoint.z / GRID_SIZE) * GRID_SIZE;
        
        let targetZ = isInitialMode ? 0 : gridZ;

        const currentTime = Date.now();
        
        if (gridX === lastHoverGrid.x && gridY === lastHoverGrid.y && targetZ === lastHoverGrid.z) {
            const elapsedTime = currentTime - hoverStartTime;
            const progress = Math.min(elapsedTime / DWELL_TIME, 1.0);

            const pixelX = indexTip.x * canvasElement.width;
            const pixelY = indexTip.y * canvasElement.height;
            drawLoadingRing(pixelX, pixelY, progress, false);

            if (elapsedTime >= DWELL_TIME && !isBlockPlacedInThisHover) {
                if (!isBlockExist(gridX, gridY, targetZ)) {
                    createBlock(gridX, gridY, targetZ, currentHexColor, true);
                    canvasCtx.beginPath();
                    canvasCtx.arc(pixelX, pixelY, 30, 0, 2 * Math.PI);
                    canvasCtx.fillStyle = `#${currentHexColor.toString(16).padStart(6, '0')}`;
                    canvasCtx.fill();
                }
                isBlockPlacedInThisHover = true; 
            }
        } else {
            hoverStartTime = currentTime;
            lastHoverGrid = { x: gridX, y: gridY, z: targetZ };
            isBlockPlacedInThisHover = false;
        }

        const previewColor = currentHexColor; 
        const previewOpacity = isBlockPlacedInThisHover ? 0.9 : 0.5;
        const previewGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        const previewMat = new THREE.MeshBasicMaterial({ color: previewColor, transparent: true, opacity: previewOpacity });
        const previewBlock = new THREE.Mesh(previewGeo, previewMat);
        
        previewBlock.position.set(gridX, gridY, targetZ);
        previewBlock.name = 'previewBlock';
        blockGroup.add(previewBlock); 
    }
}

function showGuideText(text) {
    canvasCtx.font = "bold 24px Arial";
    canvasCtx.fillStyle = "white";
    canvasCtx.strokeStyle = "black";
    canvasCtx.lineWidth = 1;
    canvasCtx.textAlign = "center";
    canvasCtx.fillText(text, canvasElement.width / 2, 60);
    canvasCtx.strokeText(text, canvasElement.width / 2, 60);
}

function drawLoadingRing(x, y, progress, isEraser) {
    const radius = 30; 
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, radius, 0, 2 * Math.PI);
    canvasCtx.lineWidth = 6;
    canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    canvasCtx.stroke();

    canvasCtx.beginPath();
    const endAngle = (2 * Math.PI * progress) - (Math.PI / 2);
    canvasCtx.arc(x, y, radius, -Math.PI / 2, endAngle);
    
    if (isEraser) {
        canvasCtx.strokeStyle = progress >= 1.0 ? "#FF0000" : "#FFaaaa";
    } else {
        canvasCtx.strokeStyle = progress >= 1.0 ? "#00FF00" : `#${currentHexColor.toString(16).padStart(6, '0')}`;
    }
    
    canvasCtx.lineWidth = 6;
    canvasCtx.stroke();
}

function createBlock(x, y, z, color = currentHexColor, save = true) {
    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const material = new THREE.MeshStandardMaterial({ 
        color: color, 
        roughness: 0.7,
        metalness: 0.1
    });
    const block = new THREE.Mesh(geometry, material);
    block.position.set(x, y, z);
    block.castShadow = true;
    block.receiveShadow = true;
    
    blockGroup.add(block);
    blocks.push(block); 

    if (save) {
        saveBlocks();
    }
}

function isBlockExist(x, y, z) {
    return blockGroup.children.some(b => 
        b.name !== 'previewBlock' && b.name !== 'deletePreview' && 
        Math.abs(b.position.x - x) < 0.1 && 
        Math.abs(b.position.y - y) < 0.1 && 
        Math.abs(b.position.z - z) < 0.1
    );
}

function clearAllBlocks() {
    for (let i = blockGroup.children.length - 1; i >= 0; i--) {
        const child = blockGroup.children[i];
        blockGroup.remove(child);
        if(child.geometry) child.geometry.dispose();
        if(child.material) child.material.dispose();
    }
    blocks.length = 0; 
    localStorage.removeItem('myARBlocks'); 
    
    camTheta = 0;
    camPhi = Math.PI / 2;
    cameraTarget.set(0, 0, 0); 
    blockGroup.scale.set(1, 1, 1);
    updateCameraPosition();
}

function startMediaPipeCamera() {
    mpCamera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({image: videoElement});
        },
        width: 640,
        height: 480,
        facingMode: isFrontCamera ? 'user' : 'environment' 
    });
    mpCamera.start();

    if (isFrontCamera) {
        canvasElement.style.transform = "scaleX(-1)";
    } else {
        canvasElement.style.transform = "scaleX(1)";
    }
}

function initMediaPipe() {
    hands = new Hands({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});
    
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    
    hands.onResults(onResults);
    
    startMediaPipeCamera();
}
