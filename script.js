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

// 커서 떨림 방지를 위한 변수 (Smoothing)
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

// [수정] 엄지 인식 감도 (비율 기반이라 수치가 다름)
const THUMB_OPEN_RATIO = 1.2; 

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
    
    // 색상/지우개 버튼
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
    
    // 기존 스트림 정지
    if (videoElement.srcObject) {
        const tracks = videoElement.srcObject.getTracks();
        tracks.forEach(track => track.stop());
    }
    
    // 카메라 재시작
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

    // 투명 벽
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

// [핵심 수정] 손가락 인식 로직 개선
// "손목-손가락끝 거리" vs "손목-손가락시작점(MCP) 거리" 비율로 판단
// 이 방식은 카메라 거리나 손의 각도(손등/손바닥)에 영향을 덜 받습니다.
function isFingerExtended(landmarks, tipIdx, mcpIdx) {
    const wrist = landmarks[0];
    const tip = landmarks[tipIdx];
    const mcp = landmarks[mcpIdx];

    const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const distMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);

    // 팁이 MCP보다 1.3배 이상 멀리 있으면 펴진 것으로 간주
    return distTip > (distMcp * 1.3);
}

// --- 4. MediaPipe 로직 ---
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // [수정] 캔버스 그리기에서는 반전 로직 제거 (CSS로 처리함)
    // 원본 그대로 그립니다. 이렇게 해야 좌표 계산이 꼬이지 않습니다.
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
        
        // 뼈대 그리기
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks, {color: '#FF0000', lineWidth: 2});

        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        
        // [개선된 손가락 판별]
        // 8:검지끝, 5:검지시작(MCP)
        const isIndexOpen = isFingerExtended(landmarks, 8, 5);
        // 12:중지끝, 9:중지시작
        const isMiddleOpen = isFingerExtended(landmarks, 12, 9);
        const isMiddleClosed = !isMiddleOpen;
        // 16:약지끝, 13:약지시작
        const isRingClosed = !isFingerExtended(landmarks, 16, 13);
        // 20:소지끝, 17:소지시작
        const isPinkyClosed = !isFingerExtended(landmarks, 20, 17);

        // 엄지는 구조가 달라서 MCP(2) 대신 IP(3) 등을 쓸 수도 있지만
        // 간단히 Tip(4) vs MCP(2) 거리 비율로 체크
        const wrist = landmarks[0];
        const tTip = landmarks[4];
        const tMcp = landmarks[2]; // 엄지 시작점 근처
        const distTTip = Math.hypot(tTip.x - wrist.x, tTip.y - wrist.y);
        const distTMcp = Math.hypot(tMcp.x - wrist.x, tMcp.y - wrist.y);
        
        // 엄지는 좀 더 기준이 낮아도 됨
        const isThumbOpen = distTTip > (distTMcp * 1.2);
        const isThumbClosed = !isThumbOpen;

        const hasBlocks = blocks.length > 0;

        // [모드 1] 회전 (검지+중지 Open)
        if (hasBlocks && isIndexOpen && isMiddleOpen && isThumbClosed && isRingClosed && isPinkyClosed) {
            isScaling = false; 
            isPanning = false;
            if (!isRotating) {
                isRotating = true;
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            } else {
                const deltaX = (indexTip.x - lastHandPos.x) * ROTATION_SPEED;
                const deltaY = (indexTip.y - lastHandPos.y) * ROTATION_SPEED;
                camTheta += deltaX * 2; 
                camPhi -= deltaY * 2;   
                updateCameraPosition();
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            }
            showGuideText("🔄 화면 회전");
        }
        
        // [모드 2] 확대/축소 (검지+엄지 Open)
        else if (hasBlocks && isIndexOpen && isThumbOpen && isMiddleClosed && isRingClosed && isPinkyClosed) {
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

        // [모드 3] 중심 이동 (검지+중지+엄지 Open)
        else if (hasBlocks && isIndexOpen && isMiddleOpen && isThumbOpen && isRingClosed && isPinkyClosed) {
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

                const moveX = camRight.multiplyScalar(deltaX * PAN_SPEED); 
                const moveY = camUp.multiplyScalar(deltaY * PAN_SPEED); 

                cameraTarget.add(moveX).add(moveY);
                updateCameraPosition();
                lastHandPos.x = indexTip.x;
                lastHandPos.y = indexTip.y;
            }
            showGuideText("🖐️ 중심 이동");
        }

        // [모드 4] 설치 OR 삭제 (검지 ☝️)
        else if (isIndexOpen && isThumbClosed && isMiddleClosed && isRingClosed && isPinkyClosed) {
            isRotating = false;
            isScaling = false;
            isPanning = false;

            if (isEraserMode) {
                processPlacement(indexTip, false);
                showGuideText("❌ 지우개 모드");
            } else {
                processPlacement(indexTip, false);
                showGuideText("☝️ 블럭 덧붙이기");
            }
        } 
        
        // [초기 모드] 블럭 없음 -> 쉬운 설치
        else if (!hasBlocks && isIndexOpen && isMiddleClosed) {
            isRotating = false;
            isScaling = false;
            isPanning = false;
            processPlacement(indexTip, true);
            showGuideText("☝️ 첫 블럭 설치");
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
    // [중요 수정] 마우스 좌표 계산 (떨림 방지 및 반전 처리)
    let targetX, targetY;

    if (isFrontCamera) {
        // 전면: CSS로 반전되므로, 좌표도 반전시켜야 시각적으로 일치
        // indexTip.x는 0(왼쪽)~1(오른쪽).
        // 화면이 거울모드면, 내 오른손(화면 오른쪽)은 x가 0에 가까움.
        // Three.js는 -1(왼쪽)~1(오른쪽).
        // 식: (1 - x) * 2 - 1
        targetX = ((1 - indexTip.x) * 2) - 1; 
    } else {
        // 후면: 반전 없음.
        // indexTip.x가 0이면 왼쪽.
        // 식: (x * 2) - 1
        targetX = (indexTip.x * 2) - 1; 
    }
    targetY = ((1 - indexTip.y) * 2) - 1; // Y축은 뒤집힘 (상단이 +1이 아니라 -1이어야 함. Threejs는 위가 +1)
    // Three.js: 위(+1), 아래(-1). MediaPipe: 위(0), 아래(1).
    // 식: -(y * 2 - 1) = (1 - y) * 2 - 1. 맞음.

    // [Smoothing] 마우스 좌표 부드럽게 이동 (떨림 방지)
    // Lerp 값을 0.5 정도로 설정 (0.1은 느림, 0.9는 빠름)
    smoothMouse.x += (targetX - smoothMouse.x) * 0.5;
    smoothMouse.y += (targetY - smoothMouse.y) * 0.5;

    raycaster.setFromCamera(smoothMouse, camera);

    // [삭제 모드]
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
                // 링 위치 계산 (후면일 때 X좌표 반전 주의)
                let drawX = pixelX;
                // 캔버스에 그릴 때는 전면일 때 CSS 반전되어 보임.
                // drawImage는 원본.
                // 전면: 시각적 X와 실제 X가 반대. 하지만 링은 실제 좌표에 그려야 함.
                // 복잡함을 피하기 위해, 그냥 indexTip 비율대로 그리면 됨.
                
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

    // [설치 모드]
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

    // [중요] CSS로만 반전 처리 (캔버스 컨텍스트는 건드리지 않음)
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
