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

const THUMB_OPEN_RATIO = 1.5; 

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

function isFingerExtended(landmarks, tipIdx, mcpIdx) {
    const wrist = landmarks[0];
    const tip = landmarks[tipIdx];
    const mcp = landmarks[mcpIdx];

    const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const distMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);

    return distTip > (distMcp * 1.3);
}

// --- 4. MediaPipe 로직 ---
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // 캔버스 그리기 (반전 없음, CSS 처리)
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
        
        // 손가락 상태 판별
        const isIndexOpen = isFingerExtended(landmarks, 8, 5);
        const isMiddleOpen = isFingerExtended(landmarks, 12, 9);
        const isMiddleClosed = !isMiddleOpen;
        const isRingClosed = !isFingerExtended(landmarks, 16, 13);
        const isPinkyClosed = !isFingerExtended(landmarks, 20, 17);

        // 엄지 판별 (비율 방식)
        const thumbTipPos = landmarks[4];
        const thumbIpPos = landmarks[3];
        const thumbMcpPos = landmarks[2];
        const thumbTotalLen = Math.hypot(thumbTipPos.x - thumbMcpPos.x, thumbTipPos.y - thumbMcpPos.y);
        const thumbBoneLen = Math.hypot(thumbIpPos.x - thumbMcpPos.x, thumbIpPos.y - thumbMcpPos.y);
        const thumbRatio = thumbTotalLen / thumbBoneLen;

        const isThumbStrictlyOpen = thumbRatio > THUMB_OPEN_RATIO;
        const isThumbConsideredClosed = !isThumbStrictlyOpen;

        const hasBlocks = blocks.length > 0;

        // [중요] 카메라 모드에 따른 좌우 방향 보정값 (1: 정방향, -1: 역방향)
        // 후면 카메라(!isFrontCamera)일 때 좌우 움직임을 반전시킴
        const dirX = isFrontCamera ? 1 : -1;

        // ========================================================
        // [우선순위 1] 손가락 2개 이상 (회전 / 중심 이동)
        // ========================================================
        
        // 1-1. 중심 이동 (검지+중지+엄지 Open)
        if (hasBlocks && isIndexOpen && isMiddleOpen && isThumbStrictlyOpen && isRingClosed && isPinkyClosed) {
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

                // [수정] dirX를 곱해서 후면 카메라일 때 반대로 이동하게 함
                const moveX = camRight.multiplyScalar(deltaX * PAN_SPEED * dirX); 
                const moveY = camUp.multiplyScalar(deltaY * PAN_SPEED); 

                cameraTarget.add(moveX).add(moveY);
                updateCameraPosition();
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            }
            showGuideText("🖐️ 중심 이동");
        }

        // 1-2. 회전 (검지+중지 Open, 엄지 Closed)
        else if (hasBlocks && isIndexOpen && isMiddleOpen && isThumbConsideredClosed && isRingClosed && isPinkyClosed) {
            isScaling = false; 
            isPanning = false;
            if (!isRotating) {
                isRotating = true;
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            } else {
                const deltaX = (indexTip.x - lastHandPos.x) * ROTATION_SPEED;
                const deltaY = (indexTip.y - lastHandPos.y) * ROTATION_SPEED;
                
                // [수정] dirX를 곱해서 후면 카메라일 때 반대로 회전하게 함
                camTheta += deltaX * 2 * dirX; 
                
                camPhi -= deltaY * 2;   
                updateCameraPosition();
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            }
            showGuideText("🔄 화면 회전");
        }
        
        // ========================================================
        // [우선순위 2] 설치 / 삭제 (검지 ☝️)
        // ========================================================
        else if (isIndexOpen && isMiddleClosed && isRingClosed && isPinkyClosed && isThumbConsideredClosed) {
            isRotating = false;
            isScaling = false;
            isPanning = false;

            if (!hasBlocks) {
                processPlacement(indexTip, true);
                showGuideText("☝️ 첫 블럭 설치");
            } else {
                if (isEraserMode) {
                    processPlacement(indexTip, false);
                    showGuideText("❌ 지우개 모드");
                } else {
                    processPlacement(indexTip, false);
                    showGuideText("☝️ 블럭 덧붙이기");
                }
            }
        } 

        // ========================================================
        // [우선순위 3] 확대/축소 (검지+엄지 Open)
        // ========================================================
        else if (hasBlocks && isIndexOpen && isMiddleClosed && isRingClosed && isPinkyClosed && isThumbStrictlyOpen) {
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
            showGuideText(`🔍 크기 조절: ${percent}%`);
        }
        
        else {
            isRotating = false;
            isScaling = false;
            isPanning = false;
            if (hasBlocks) {
                showGuideText("✋ 대기 중");
            } else {
                showGuideText("☝️ 검지를 펴서 시작하세요");
            }
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
