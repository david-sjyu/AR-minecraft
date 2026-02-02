// --- 1. 전역 변수 선언 ---
let scene, camera, renderer, controls;
let videoElement, canvasElement, canvasCtx;
let hands;
let mpCamera; // MediaPipe Camera 객체 저장용

const BLOCK_SIZE = 2.0; 
const GRID_SIZE = BLOCK_SIZE;
const blocks = []; 
let blockGroup; 

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

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

const THUMB_OPEN_THRESHOLD = 0.12; 

let currentHexColor = 0xff3333; 
let isEraserMode = false; 

// [추가] 카메라 모드 상태 (true: 전면, false: 후면)
let isFrontCamera = true;

// --- 2. 초기화 실행 ---
window.onload = function() {
    videoElement = document.getElementsByClassName('input_video')[0];
    canvasElement = document.getElementsByClassName('output_canvas')[0];
    canvasCtx = canvasElement.getContext('2d');

    resizeCanvasToDisplaySize();

    document.getElementById('clearBtn').addEventListener('click', clearAllBlocks);
    
    // [추가] 카메라 전환 버튼 이벤트
    document.getElementById('cameraBtn').addEventListener('click', toggleCamera);

    // 색상 팔레트 이벤트
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

// [신규] 카메라 전환 함수
function toggleCamera() {
    isFrontCamera = !isFrontCamera; // 상태 토글
    
    // 기존 카메라 스트림 중지 (중요: 이걸 안 하면 카메라가 안 바뀜)
    if (videoElement.srcObject) {
        const tracks = videoElement.srcObject.getTracks();
        tracks.forEach(track => track.stop());
    }

    // 카메라 다시 시작
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

// --- 4. MediaPipe 로직 ---
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // [중요] 후면 카메라일 때는 좌우 반전(거울 모드)을 끕니다.
    // 전면 카메라(isFrontCamera)일 때만 이미지를 반전시켜 그림
    if (isFrontCamera) {
        canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(results.image, -canvasElement.width, 0, canvasElement.width, canvasElement.height);
    } else {
        // 후면 카메라는 있는 그대로 그림
        canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    }
    
    // 캔버스 설정 복구 (좌표계가 꼬이지 않게)
    canvasCtx.restore();

    // 여기서부터는 좌표계가 원래대로 돌아오므로,
    // 전면 카메라일 때 랜드마크를 그릴 때도 X좌표를 뒤집어서 그려야 합니다.
    // 하지만 drawConnectors 유틸은 좌표를 그대로 씁니다.
    // Three.js 레이캐스팅을 위해 mouse 좌표 계산시 이 반전 여부를 고려해야 합니다.

    const oldPreview = blockGroup.getObjectByName('previewBlock');
    if (oldPreview) blockGroup.remove(oldPreview);
    
    const oldDeletePreview = blockGroup.getObjectByName('deletePreview');
    if (oldDeletePreview) blockGroup.remove(oldDeletePreview);
    
    const cursor = scene.getObjectByName('cursor');
    if(cursor) cursor.visible = false;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // 캔버스에 손 그리기
        // (전면 카메라일 때 캔버스 자체를 CSS로 반전시키는 방법이 있고, 그리기 로직에서 반전하는 방법이 있습니다.)
        // 기존 코드에서는 CSS transform: scaleX(-1)을 썼으므로, JS에서는 그대로 그려도 됩니다.
        // 다만 후면 카메라일 때는 CSS 반전을 꺼야 합니다.
        
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks, {color: '#FF0000', lineWidth: 2});

        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        
        const isIndexOpen = landmarks[8].y < landmarks[6].y;
        const isMiddleOpen = landmarks[12].y < landmarks[10].y;
        const isMiddleClosed = !isMiddleOpen;
        const isRingClosed = landmarks[16].y > landmarks[14].y;
        const isPinkyClosed = landmarks[20].y > landmarks[18].y;

        const thumbIndexDist = Math.hypot(landmarks[4].x - landmarks[5].x, landmarks[4].y - landmarks[5].y);
        const isThumbOpen = thumbIndexDist > THUMB_OPEN_THRESHOLD; 
        const isThumbClosed = !isThumbOpen;

        const hasBlocks = blocks.length > 0;

        // [모드 1] 회전
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
        
        // [모드 2] 확대/축소
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

        // [모드 3] 중심 이동
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

        // [모드 4] 설치 OR 삭제
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
        
        // [초기 모드]
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
    // [중요] 마우스(터치) 좌표 계산 시, 후면 카메라는 좌우 반전을 안 하므로 계산식이 달라짐
    if (isFrontCamera) {
        // 전면: 기존과 동일 (거울 모드)
        mouse.x = ((1 - indexTip.x) * 2) - 1; 
    } else {
        // 후면: 반전 없음 (MediaPipe 좌표 그대로 사용)
        // MediaPipe x는 0(왼쪽) ~ 1(오른쪽) -> Three.js -1(왼쪽) ~ 1(오른쪽)
        // 공식: (x * 2) - 1
        mouse.x = (indexTip.x * 2) - 1; 
    }
    mouse.y = ((1 - indexTip.y) * 2) - 1; // Y축은 공통

    raycaster.setFromCamera(mouse, camera);

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
                // 후면 카메라일 때 링 위치 조정 (X축)
                const drawX = isFrontCamera ? pixelX : (canvasElement.width - pixelX);
                
                // 링 그리기 좌표는 사실 캔버스 scale(-1, 1) 여부에 따라 달라짐.
                // 위 onResults에서 drawImage를 처리했으므로, 여기서 복잡하게 계산할 필요 없이
                // 그냥 indexTip 좌표를 그대로 쓰되, 캔버스 렌더링 방식에 맞춤.
                // *간단한 해결*: 링은 항상 indexTip 위치에 그린다.
                drawLoadingRing(pixelX, pixelY, progress, true); 

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

    // 설치 모드
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

// [수정] 카메라 초기화 함수 분리
function startMediaPipeCamera() {
    mpCamera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({image: videoElement});
        },
        width: 640,
        height: 480,
        facingMode: isFrontCamera ? 'user' : 'environment' // 카메라 모드 설정
    });
    mpCamera.start();

    // CSS 미러링 처리 (전면: 반전 O, 후면: 반전 X)
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
    
    // 분리된 카메라 시작 함수 호출
    startMediaPipeCamera();
}
