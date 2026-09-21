var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
// ---------------------------------------------------------------------------
// Phaser TypeScript Definitions Test
// ---------------------------------------------------------------------------
// This file exercises as much of the Phaser API surface as possible so that
// TypeScript compilation errors reveal problems in the generated .d.ts file.
// It is NOT a runtime test -- it just needs to compile cleanly.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
var BootScene = /** @class */ (function (_super) {
    __extends(BootScene, _super);
    function BootScene() {
        return _super.call(this, { key: 'BootScene', active: true }) || this;
    }
    BootScene.prototype.init = function (data) {
    };
    BootScene.prototype.preload = function () {
        // Loader - various file types (files do not exist, so these will 404 at runtime, but that's not what we're testing here)
        this.load.image('logo', 'assets/logo.png');
        this.load.atlas('cards', 'assets/atlas/cards.png', 'assets/atlas/cards.json');
        this.load.spritesheet('gems', 'assets/gems.png', { frameWidth: 32, frameHeight: 32 });
        this.load.audio('bgm', ['assets/bgm.ogg', 'assets/bgm.mp3']);
        this.load.bitmapFont('font', 'assets/font.png', 'assets/font.fnt');
        this.load.tilemapTiledJSON('map', 'assets/map.json');
        this.load.json('data', 'assets/data.json');
        this.load.text('story', 'assets/story.txt');
        this.load.glsl('shader', 'assets/shader.frag');
        this.load.html('form', 'assets/form.html');
        this.load.video('intro', 'assets/intro.mp4');
        // Loader events
        this.load.on(Phaser.Loader.Events.COMPLETE, function () { });
        this.load.on(Phaser.Loader.Events.PROGRESS, function (value) { });
    };
    BootScene.prototype.create = function () {
        // ---------------------------------------------------------------
        // Game Objects - Core types
        // ---------------------------------------------------------------
        // Image
        var image = this.add.image(100, 100, 'logo');
        image.setOrigin(0.5, 0.5);
        image.setScale(2);
        image.setAngle(45);
        image.setAlpha(0.8);
        image.setDepth(10);
        image.setPosition(200, 200);
        image.setRotation(Math.PI / 4);
        image.setVisible(true);
        image.setBlendMode(Phaser.BlendModes.ADD);
        image.setScrollFactor(1, 1);
        image.setFlip(true, false);
        image.setTint(0xff0000);
        image.setTexture('logo');
        image.setDisplaySize(64, 64);
        image.setSize(64, 64);
        image.setInteractive();
        image.setName('myImage');
        image.setData('score', 100);
        image.getData('score');
        image.setDataEnabled();
        image.destroy();
        // Sprite
        var sprite = this.add.sprite(400, 300, 'cards', 'clubs3');
        sprite.play('walk');
        sprite.anims.pause();
        sprite.anims.resume();
        sprite.anims.stop();
        // Text
        var text = this.add.text(100, 100, 'Hello Phaser 4', {
            fontFamily: 'Arial',
            fontSize: '32px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 300 },
            padding: { x: 10, y: 10 },
            backgroundColor: '#000000',
            stroke: '#ff0000',
            strokeThickness: 2,
            shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 4, fill: true }
        });
        text.setText('Updated text');
        text.setStyle({ fontSize: '48px' });
        text.setColor('#00ff00');
        text.setFontSize(24);
        text.setFontFamily('Courier');
        text.setWordWrapWidth(400);
        text.setPadding(10, 10, 10, 10);
        // BitmapText
        var bitmapText = this.add.bitmapText(200, 200, 'font', 'Hello', 32);
        bitmapText.setText('Updated');
        bitmapText.setFontSize(48);
        bitmapText.setLetterSpacing(2);
        bitmapText.setTint(0x00ff00);
        // Container
        var container = this.add.container(0, 0);
        container.add(sprite);
        container.addAt(image, 0);
        container.setSize(300, 200);
        container.setDepth(5);
        container.removeAll();
        // Layer
        var layer = this.add.layer();
        layer.add(sprite);
        layer.setDepth(1);
        layer.setVisible(true);
        // Graphics
        var graphics = this.add.graphics();
        graphics.fillStyle(0xff0000, 1);
        graphics.fillRect(0, 0, 100, 100);
        graphics.fillCircle(200, 200, 50);
        graphics.fillRoundedRect(0, 0, 200, 100, 16);
        graphics.lineStyle(2, 0x00ff00, 1);
        graphics.strokeRect(50, 50, 100, 100);
        graphics.strokeCircle(300, 300, 75);
        graphics.lineBetween(0, 0, 400, 400);
        graphics.beginPath();
        graphics.moveTo(0, 0);
        graphics.lineTo(100, 100);
        graphics.closePath();
        graphics.strokePath();
        graphics.fillPath();
        graphics.clear();
        // Shapes
        var rect = this.add.rectangle(100, 100, 200, 150, 0xff0000);
        rect.setStrokeStyle(2, 0x00ff00);
        var circle = this.add.circle(300, 300, 50, 0x0000ff);
        circle.setStrokeStyle(1, 0xffffff);
        var triangle = this.add.triangle(400, 400, 0, 100, 50, 0, 100, 100, 0xff00ff);
        var ellipse = this.add.ellipse(500, 300, 120, 80, 0xffff00);
        var line = this.add.line(0, 0, 100, 100, 300, 300, 0x00ffff);
        line.setLineWidth(3);
        var star = this.add.star(200, 200, 5, 30, 60, 0xffaa00);
        var polygon = this.add.polygon(300, 300, [0, 0, 100, 0, 100, 100, 0, 100], 0x00aaff);
        var arc = this.add.arc(400, 200, 50, 0, 270, false, 0xaa00ff);
        var grid = this.add.grid(400, 300, 256, 256, 32, 32, 0x222222, 1, 0x444444, 1);
        // NineSlice
        var nineSlice = this.add.nineslice(400, 300, 'logo', undefined, 256, 128, 20, 20, 20, 20);
        nineSlice.setSize(512, 256);
        // TileSprite
        var tileSprite = this.add.tileSprite(400, 300, 800, 600, 'logo');
        tileSprite.setTilePosition(10, 20);
        tileSprite.setTileScale(2, 2);
        // Video
        var video = this.add.video(400, 300, 'intro');
        video.play(true);
        // Zone
        var zone = this.add.zone(400, 300, 200, 200);
        zone.setInteractive();
        // Particles
        var particles = this.add.particles(400, 300, 'logo', {
            speed: 100,
            scale: { start: 1, end: 0 },
            lifespan: 2000,
            blendMode: Phaser.BlendModes.ADD,
            frequency: 50,
            quantity: 2,
            gravityY: 200,
            alpha: { start: 1, end: 0 },
            angle: { min: 0, max: 360 },
            rotate: { min: 0, max: 360 },
            emitting: true
        });
        particles.stop();
        particles.start();
        // Blitter
        var blitter = this.add.blitter(0, 0, 'cards');
        blitter.create(100, 100, 'clubs3');
        // ---------------------------------------------------------------
        // RenderTexture / DynamicTexture
        // ---------------------------------------------------------------
        var rt = this.add.renderTexture(400, 300, 256, 256);
        rt.draw(sprite);
        rt.clear();
        var dt = this.textures.addDynamicTexture('dynamic', 256, 256);
        if (dt) {
            dt.fill(0xff0000);
            dt.stamp('logo', undefined, 128, 128);
        }
        // ---------------------------------------------------------------
        // Animations
        // ---------------------------------------------------------------
        this.anims.create({
            key: 'walk',
            frames: this.anims.generateFrameNumbers('gems', { start: 0, end: 7 }),
            frameRate: 10,
            repeat: -1,
            yoyo: true
        });
        this.anims.create({
            key: 'explode',
            frames: this.anims.generateFrameNames('cards', {
                prefix: 'clubs',
                start: 1,
                end: 10
            }),
            frameRate: 20,
            repeat: 0,
            hideOnComplete: true
        });
        var anim = this.anims.get('walk');
        if (anim) {
            var totalFrames = anim.getTotalFrames();
        }
        this.anims.remove('walk');
        // ---------------------------------------------------------------
        // Input
        // ---------------------------------------------------------------
        // Pointer input
        this.input.on(Phaser.Input.Events.POINTER_DOWN, function (pointer) {
            var x = pointer.x;
            var y = pointer.y;
            var isDown = pointer.isDown;
            var worldX = pointer.worldX;
            var worldY = pointer.worldY;
        });
        this.input.on(Phaser.Input.Events.POINTER_UP, function () { });
        this.input.on(Phaser.Input.Events.POINTER_MOVE, function () { });
        // Game object input events
        sprite.on(Phaser.Input.Events.POINTER_OVER, function () { });
        sprite.on(Phaser.Input.Events.POINTER_OUT, function () { });
        sprite.on(Phaser.Input.Events.DRAG_START, function () { });
        sprite.on(Phaser.Input.Events.DRAG, function () { });
        sprite.on(Phaser.Input.Events.DRAG_END, function () { });
        this.input.setDraggable(sprite);
        // Keyboard
        var cursors = this.input.keyboard.createCursorKeys();
        var spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        var combo = this.input.keyboard.createCombo('PHASER', {
            resetOnWrongKey: true,
            resetOnMatch: true
        });
        // ---------------------------------------------------------------
        // Camera
        // ---------------------------------------------------------------
        var cam = this.cameras.main;
        cam.setZoom(1.5);
        cam.setScroll(100, 100);
        cam.setBounds(0, 0, 1600, 1200);
        cam.setBackgroundColor(0x222222);
        cam.setSize(800, 600);
        cam.setPosition(0, 0);
        cam.setRotation(0.1);
        cam.setRoundPixels(true);
        cam.startFollow(sprite, true, 0.1, 0.1);
        cam.stopFollow();
        cam.fadeIn(1000);
        cam.fadeOut(1000);
        cam.flash(500);
        cam.shake(300, 0.01);
        cam.pan(400, 300, 2000);
        cam.zoomTo(2, 1000);
        cam.ignore(graphics);
        cam.centerOn(400, 300);
        cam.setViewport(0, 0, 800, 600);
        var cam2 = this.cameras.add(0, 0, 400, 300);
        this.cameras.remove(cam2);
        // ---------------------------------------------------------------
        // Tweens
        // ---------------------------------------------------------------
        var tween = this.tweens.add({
            targets: sprite,
            x: 600,
            y: 400,
            alpha: 0.5,
            scaleX: 2,
            scaleY: 2,
            rotation: Math.PI,
            duration: 2000,
            ease: 'Power2',
            delay: 500,
            repeat: 3,
            repeatDelay: 200,
            yoyo: true,
            hold: 100,
            onStart: function () { },
            onComplete: function () { },
            onUpdate: function () { },
            onRepeat: function () { },
            onYoyo: function () { }
        });
        tween.pause();
        tween.resume();
        tween.stop();
        tween.remove();
        // Tween chain
        var chain = this.tweens.chain({
            targets: sprite,
            tweens: [
                { x: 100, duration: 500 },
                { y: 100, duration: 500 },
                { x: 400, y: 300, duration: 1000 }
            ],
            loop: 2
        });
        // Number tween
        var counter = this.tweens.addCounter({
            from: 0,
            to: 100,
            duration: 2000,
            ease: 'Linear',
            onUpdate: function (tween) {
                var value = tween.getValue();
            }
        });
        // Stagger
        this.tweens.add({
            targets: [sprite, image],
            y: 500,
            duration: 1000,
            delay: this.tweens.stagger(100)
        });
        // ---------------------------------------------------------------
        // Timer Events
        // ---------------------------------------------------------------
        this.time.addEvent({
            delay: 1000,
            callback: function () { },
            callbackScope: this,
            loop: true
        });
        this.time.delayedCall(2000, function () { });
        // ---------------------------------------------------------------
        // Physics - Arcade
        // ---------------------------------------------------------------
        var physSprite = this.physics.add.sprite(400, 300, 'logo');
        physSprite.setVelocity(100, 200);
        physSprite.setAcceleration(10, 10);
        physSprite.setBounce(0.5, 0.5);
        physSprite.setCollideWorldBounds(true);
        physSprite.setDrag(50, 50);
        physSprite.setFriction(0.1, 0.1);
        physSprite.setGravityY(300);
        physSprite.setImmovable(false);
        physSprite.setMass(1);
        physSprite.setMaxVelocity(300, 300);
        physSprite.setCircle(16);
        physSprite.setSize(32, 32);
        physSprite.setOffset(0, 0);
        var physImage = this.physics.add.image(200, 200, 'logo');
        physImage.setVelocityX(50);
        var staticGroup = this.physics.add.staticGroup();
        var dynamicGroup = this.physics.add.group();
        this.physics.add.collider(physSprite, staticGroup);
        this.physics.add.overlap(physSprite, dynamicGroup, function (obj1, obj2) { });
        this.physics.world.setBounds(0, 0, 1600, 1200);
        this.physics.world.gravity.y = 300;
        var closest = this.physics.closest(physSprite);
        // ---------------------------------------------------------------
        // Tilemap
        // ---------------------------------------------------------------
        var tilemap = this.make.tilemap({ key: 'map' });
        var tileset = tilemap.addTilesetImage('tiles', 'logo');
        if (tileset) {
            var tilemapLayer = tilemap.createLayer('ground', tileset, 0, 0);
            if (tilemapLayer) {
                tilemapLayer.setCollisionByProperty({ collides: true });
                tilemapLayer.setCollisionBetween(1, 100);
                tilemapLayer.setTileIndexCallback(1, function () { }, this);
                tilemap.setCollision([1, 2, 3]);
            }
            tilemap.createFromObjects('objects', { gid: 1 });
        }
        // ---------------------------------------------------------------
        // Scene Management
        // ---------------------------------------------------------------
        this.scene.start('BootScene', { level: 1 });
        this.scene.launch('BootScene');
        this.scene.pause('BootScene');
        this.scene.resume('BootScene');
        this.scene.stop('BootScene');
        this.scene.restart();
        this.scene.setVisible(true);
        this.scene.sendToBack('BootScene');
        this.scene.bringToTop('BootScene');
        this.scene.moveUp('BootScene');
        this.scene.moveDown('BootScene');
        // ---------------------------------------------------------------
        // Sound
        // ---------------------------------------------------------------
        var sound = this.sound.add('bgm', {
            volume: 0.5,
            loop: true,
            delay: 0
        });
        sound.play();
        sound.pause();
        sound.resume();
        sound.stop();
        this.sound.pauseAll();
        this.sound.resumeAll();
        this.sound.stopAll();
        // ---------------------------------------------------------------
        // Data Manager
        // ---------------------------------------------------------------
        this.registry.set('highscore', 1000);
        var hs = this.registry.get('highscore');
        this.registry.remove('highscore');
        this.data.set('lives', 3);
        this.data.get('lives');
        this.data.remove('lives');
        // ---------------------------------------------------------------
        // Events
        // ---------------------------------------------------------------
        this.events.on('custom-event', function (data) { });
        this.events.emit('custom-event', { score: 100 });
        this.events.once('one-time', function () { });
        this.events.off('custom-event');
        this.game.events.on(Phaser.Core.Events.BLUR, function () { });
        this.game.events.on(Phaser.Core.Events.FOCUS, function () { });
        this.game.events.on(Phaser.Core.Events.HIDDEN, function () { });
        this.game.events.on(Phaser.Core.Events.VISIBLE, function () { });
        // ---------------------------------------------------------------
        // Math
        // ---------------------------------------------------------------
        var between = Phaser.Math.Between(1, 100);
        var clamp = Phaser.Math.Clamp(150, 0, 100);
        var distance = Phaser.Math.Distance.Between(0, 0, 100, 100);
        var chebyshev = Phaser.Math.Distance.Chebyshev(0, 0, 100, 100);
        var snake = Phaser.Math.Distance.Snake(0, 0, 100, 100);
        var mathAngle = Phaser.Math.Angle.Between(0, 0, 100, 100);
        var angleBetweenPoints = Phaser.Math.Angle.BetweenPoints({ x: 0, y: 0 }, { x: 100, y: 100 });
        var angleWrap = Phaser.Math.Angle.Wrap(7);
        var degToRad = Phaser.Math.DegToRad(90);
        var radToDeg = Phaser.Math.RadToDeg(Math.PI);
        var lerp = Phaser.Math.Linear(0, 100, 0.5);
        var percent = Phaser.Math.Percent(50, 0, 100);
        var snap = Phaser.Math.Snap.To(55, 10);
        var snapFloor = Phaser.Math.Snap.Floor(55, 10);
        var snapCeil = Phaser.Math.Snap.Ceil(55, 10);
        var fuzzyEqual = Phaser.Math.Fuzzy.Equal(1.001, 1, 0.01);
        var fuzzyGreater = Phaser.Math.Fuzzy.GreaterThan(1.001, 1, 0.01);
        var fuzzyLess = Phaser.Math.Fuzzy.LessThan(0.999, 1, 0.01);
        var tau = Phaser.Math.TAU;
        var piOver2 = Phaser.Math.PI_OVER_2;
        // Vector2
        var v1 = new Phaser.Math.Vector2(10, 20);
        var v2 = new Phaser.Math.Vector2(30, 40);
        v1.add(v2);
        v1.subtract(v2);
        v1.scale(2);
        v1.normalize();
        var len = v1.length();
        var lenSq = v1.lengthSq();
        var dot = v1.dot(v2);
        var cross = v1.cross(v2);
        v1.lerp(v2, 0.5);
        v1.set(5, 10);
        v1.setAngle(Math.PI);
        v1.setLength(100);
        v1.negate();
        v1.rotate(Math.PI / 2);
        var v1Clone = v1.clone();
        v1.copy(v2);
        v1.equals(v2);
        v1.ceil();
        v1.floor();
        v1.invert();
        v1.project(v2);
        // Vector3
        var v3 = new Phaser.Math.Vector3(1, 2, 3);
        var v4 = new Phaser.Math.Vector3(4, 5, 6);
        v3.add(v4);
        v3.subtract(v4);
        v3.scale(2);
        v3.normalize();
        v3.cross(v4);
        // Matrix
        var matrix = new Phaser.Math.Matrix4();
        matrix.identity();
        matrix.translate(new Phaser.Math.Vector3(1, 2, 3));
        matrix.scale(new Phaser.Math.Vector3(2, 2, 2));
        matrix.invert();
        matrix.transpose();
        matrix.determinant();
        // Random data generator
        var rng = new Phaser.Math.RandomDataGenerator(['seed1']);
        var rngInt = rng.integer();
        var rngReal = rng.real();
        var rngFrac = rng.frac();
        var rngBetween = rng.between(0, 100);
        var rngSign = rng.sign();
        var rngAngle = rng.angle();
        var rngPick = rng.pick(['a', 'b', 'c']);
        var rngWeightedPick = rng.weightedPick(['a', 'b', 'c']);
        // ---------------------------------------------------------------
        // Geometry
        // ---------------------------------------------------------------
        // Circle
        var geomCircle = new Phaser.Geom.Circle(100, 100, 50);
        var circleArea = Phaser.Geom.Circle.Area(geomCircle);
        var circumference = Phaser.Geom.Circle.Circumference(geomCircle);
        var circleContains = geomCircle.contains(110, 110);
        var circlePoint = geomCircle.getPoint(0.5);
        var circlePoints = geomCircle.getPoints(10);
        var circleRandom = geomCircle.getRandomPoint();
        // Rectangle
        var geomRect = new Phaser.Geom.Rectangle(0, 0, 200, 100);
        var rectArea = Phaser.Geom.Rectangle.Area(geomRect);
        var rectPerimeter = Phaser.Geom.Rectangle.Perimeter(geomRect);
        var rectContains = geomRect.contains(50, 50);
        var rectPoint = geomRect.getPoint(0.5);
        var rectPoints = geomRect.getPoints(10);
        var rectRandom = geomRect.getRandomPoint();
        var rectCenter = Phaser.Geom.Rectangle.GetCenter(geomRect);
        var rectSize = Phaser.Geom.Rectangle.GetSize(geomRect);
        Phaser.Geom.Rectangle.Inflate(geomRect, 10, 10);
        Phaser.Geom.Rectangle.CeilAll(geomRect);
        Phaser.Geom.Rectangle.FloorAll(geomRect);
        // Line
        var geomLine = new Phaser.Geom.Line(0, 0, 100, 100);
        var lineLength = Phaser.Geom.Line.Length(geomLine);
        var lineAngle = Phaser.Geom.Line.Angle(geomLine);
        var linePoint = geomLine.getPoint(0.5);
        var linePoints = geomLine.getPoints(10);
        var lineMid = Phaser.Geom.Line.GetMidPoint(geomLine);
        // Triangle
        var geomTriangle = new Phaser.Geom.Triangle(0, 100, 50, 0, 100, 100);
        var triArea = Phaser.Geom.Triangle.Area(geomTriangle);
        var triContains = geomTriangle.contains(50, 50);
        var triPoint = geomTriangle.getPoint(0.5);
        var triPoints = geomTriangle.getPoints(10);
        var triCentroid = Phaser.Geom.Triangle.Centroid(geomTriangle);
        var triInCenter = Phaser.Geom.Triangle.InCenter(geomTriangle);
        // Ellipse
        var geomEllipse = new Phaser.Geom.Ellipse(200, 200, 100, 60);
        var ellipseArea = Phaser.Geom.Ellipse.Area(geomEllipse);
        var ellipseContains = geomEllipse.contains(200, 200);
        var ellipsePoint = geomEllipse.getPoint(0.5);
        var ellipsePoints = geomEllipse.getPoints(10);
        // Polygon
        var geomPolygon = new Phaser.Geom.Polygon([0, 0, 100, 0, 100, 100, 0, 100]);
        var polyArea = Phaser.Geom.Polygon.GetAABB(geomPolygon).width;
        var polyContains = geomPolygon.contains(50, 50);
        var polyPoints = geomPolygon.getPoints(10);
        // Intersects
        var rectOverlap = Phaser.Geom.Intersects.RectangleToRectangle(geomRect, new Phaser.Geom.Rectangle(50, 50, 100, 100));
        var circleRect = Phaser.Geom.Intersects.CircleToRectangle(geomCircle, geomRect);
        var lineRect = Phaser.Geom.Intersects.LineToRectangle(geomLine, geomRect);
        var lineCircle = Phaser.Geom.Intersects.LineToCircle(geomLine, geomCircle);
        // ---------------------------------------------------------------
        // Display - Color
        // ---------------------------------------------------------------
        var color = new Phaser.Display.Color(255, 128, 0, 255);
        var r = color.red;
        var g = color.green;
        var b = color.blue;
        var a = color.alpha;
        var colorInt = color.color;
        var colorStr = color.rgba;
        color.setTo(0, 255, 0, 255);
        var fromHex = Phaser.Display.Color.HexStringToColor('#ff0000');
        var fromInt = Phaser.Display.Color.IntegerToColor(0xff0000);
        var fromRGB = Phaser.Display.Color.RGBStringToColor('rgb(255,0,0)');
        var fromValue = Phaser.Display.Color.ValueToColor('#ff0000');
        var random = Phaser.Display.Color.RandomRGB();
        var interpolated = Phaser.Display.Color.Interpolate.ColorWithColor(color, fromHex, 100, 50);
        // ---------------------------------------------------------------
        // Texture Manager
        // ---------------------------------------------------------------
        var texManager = this.textures;
        var exists = texManager.exists('logo');
        var texture = texManager.get('logo');
        var frame = texture.get();
        var frameWidth = frame.width;
        var frameHeight = frame.height;
        // ---------------------------------------------------------------
        // Scale Manager
        // ---------------------------------------------------------------
        var scaleManager = this.scale;
        scaleManager.resize(1024, 768);
        scaleManager.setGameSize(1024, 768);
        var gameWidth = scaleManager.width;
        var gameHeight = scaleManager.height;
        scaleManager.lockOrientation('landscape');
        // ---------------------------------------------------------------
        // Game Config
        // ---------------------------------------------------------------
        var config2 = {
            type: Phaser.WEBGL,
            width: 1024,
            height: 768,
            parent: 'game',
            backgroundColor: '#000000',
            scene: BootScene,
            physics: {
                default: 'arcade',
                arcade: {
                    gravity: { x: 0, y: 300 },
                    debug: true
                }
            },
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH,
                width: 1024,
                height: 768
            },
            input: {
                keyboard: true,
                mouse: true,
                touch: true,
                gamepad: true
            },
            render: {
                pixelArt: false,
                antialias: true,
                roundPixels: false
            },
            audio: {
                disableWebAudio: false
            }
        };
        // ---------------------------------------------------------------
        // Actions
        // ---------------------------------------------------------------
        var sprites = [sprite, physSprite];
        Phaser.Actions.SetXY(sprites, 100, 200);
        Phaser.Actions.SetAlpha(sprites, 0.5);
        Phaser.Actions.SetRotation(sprites, 1.5);
        Phaser.Actions.SetScale(sprites, 2, 2);
        Phaser.Actions.SetVisible(sprites, true);
        Phaser.Actions.SetDepth(sprites, 10);
        Phaser.Actions.SetBlendMode(sprites, Phaser.BlendModes.ADD);
        Phaser.Actions.SetScrollFactor(sprites, 0.5, 0.5);
        Phaser.Actions.IncXY(sprites, 10, 20);
        Phaser.Actions.Rotate(sprites, 0.1);
        Phaser.Actions.PlaceOnCircle(sprites, geomCircle);
        Phaser.Actions.PlaceOnLine(sprites, geomLine);
        Phaser.Actions.PlaceOnRectangle(sprites, geomRect);
        Phaser.Actions.PlaceOnTriangle(sprites, geomTriangle);
        Phaser.Actions.PlaceOnEllipse(sprites, geomEllipse);
        Phaser.Actions.RandomCircle(sprites, geomCircle);
        Phaser.Actions.RandomRectangle(sprites, geomRect);
        Phaser.Actions.RandomLine(sprites, geomLine);
        Phaser.Actions.RandomTriangle(sprites, geomTriangle);
        Phaser.Actions.RandomEllipse(sprites, geomEllipse);
        Phaser.Actions.Spread(sprites, 'x', 0, 800);
        Phaser.Actions.Shuffle(sprites);
        Phaser.Actions.GetFirst(sprites, { active: true });
        Phaser.Actions.GetLast(sprites, { active: true });
        // ---------------------------------------------------------------
        // Structs
        // ---------------------------------------------------------------
        var list = new Phaser.Structs.List(null);
        list.add(sprite);
        list.remove(sprite);
        var pq = new Phaser.Structs.ProcessQueue();
        pq.add(sprite);
        pq.remove(sprite);
        pq.update();
        // ---------------------------------------------------------------
        // Utils
        // ---------------------------------------------------------------
        var arr = Phaser.Utils.Array.Shuffle([1, 2, 3, 4, 5]);
        var removed = Phaser.Utils.Array.Remove(arr, 3);
        var item = Phaser.Utils.Array.GetRandom(arr);
        var merged = Phaser.Utils.Objects.Merge({ a: 1 }, { b: 2 });
        var value = Phaser.Utils.Objects.GetValue({ nested: { key: 42 } }, 'nested.key', 0);
        var objClone = Phaser.Utils.Objects.Clone({ x: 1, y: 2 });
        var padded = Phaser.Utils.String.Pad('42', 5, '0', 1);
    };
    BootScene.prototype.update = function (time, delta) {
        // Standard update parameters
        var fps = this.game.loop.actualFps;
    };
    return BootScene;
}(Phaser.Scene));
// ---------------------------------------------------------------------------
// Game instantiation
// ---------------------------------------------------------------------------
var config = {
    type: Phaser.AUTO,
    parent: 'phaser-example',
    width: 800,
    height: 600,
    scene: BootScene
};
var game = new Phaser.Game(config);
//# sourceMappingURL=game.js.map