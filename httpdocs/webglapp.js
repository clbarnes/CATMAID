
var camera;

var WebGLApp = new function () {

  self = this;
  self.neurons = [];

  var scene, renderer, grid_lines, scale, controls, light, zplane = null, meshes = [], show_meshes = false, show_active_node = false;
  var project_id, stack_id, resolution, dimension, translation, canvasWidth, canvasHeight, ortho = false,
      bbmesh, floormesh, black_bg = true, debugax;
	var is_mouse_down = false;

  this.init = function( divID ) {

    self.project_id = project.id;
    self.stack_id = project.focusedStack.id;

    self.divID = divID;
    self.divID_jQuery = '#' + divID;

    self.divWidth = $(this.divID_jQuery).width();
    self.divHeight = $(this.divID_jQuery).height();

    resolution = project.focusedStack.resolution;
    dimension = project.focusedStack.dimension;
    translation = project.focusedStack.translation;

    init_webgl();
    debugaxes();
    draw_grid();
    XYView();

    // if there is an active skeleton, add it to the view
    if(SkeletonAnnotations.getActiveNodeId()) {
      self.addSkeletonFromID( self.project_id, SkeletonAnnotations.getActiveSkeletonId() );

      // and create active node
      $('#enable_active_node').attr('checked', true);
      self.createActiveNode();
    }

		self.render();
  }

	/** Clean up. */
	this.destroy = function() {
		renderer.domElement.removeEventListener('mousedown', onMouseDown, false);
		renderer.domElement.removeEventListener('mouseup', onMouseUp, false);
		renderer.domElement.removeEventListener('mousemove', onMouseMove, false);
	  renderer.domElement.removeEventListener('mousewheel', onMouseWheel, false);
		self.removeAllSkeletons();
	};

  var randomColors = [];
  randomColors[0] = [255, 255, 0]; // yellow
  randomColors[1] = [255, 0, 255]; // magenta
  // randomColors[2] = [0, 255, 255]; // cyan
  randomColors[2] = [255, 255, 255]; // white
  randomColors[3] = [255, 128, 0]; // orange

  /* transform coordinates from CATMAID coordinate system
     to WebGL coordinate system: x->x, y->y+dy, z->-z
    */
  var transform_coordinates = function ( point ) {
    return [point[0],-point[1]+dimension.y*resolution.y,-point[2] ];
  }

  var connectivity_types = new Array('neurite', 'presynaptic_to', 'postsynaptic_to');

  function init_webgl() {
    container = document.getElementById(self.divID);
    scene = new THREE.Scene();
    //camera = new THREE.PerspectiveCamera( 75, self.divWidth / self.divHeight, 1, 3000 );

    //camera = new THREE.OrthographicCamera( self.divWidth / -2, self.divWidth / 2, self.divHeight / 2, self.divHeight / -2, 1, 1000 );
      //camera = new THREE.OrthographicCamera( self.divWidth / -2, self.divWidth / 2, self.divHeight / 2, self.divHeight / -2, 1, 1000 );
    camera = new THREE.CombinedCamera( -self.divWidth, -self.divHeight, 75, 1, 3000, -1000, 1, 500 );
    camera.frustumCulled = false;
    // THREE.CombinedCamera = function ( width, height, fov, near, far, orthonear, orthofar ) {
    controls = new THREE.TrackballControls( camera, container );
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;


    var ambient = new THREE.AmbientLight( 0x101010 );
    scene.add( ambient );

    directionalLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
    directionalLight.position.set( 1, 1, 2 ).normalize();
    scene.add( directionalLight );

    pointLight = new THREE.PointLight( 0xffaa00 );
    pointLight.position.set( 0, 0, 0 );
    scene.add( pointLight );
/*
    // light representation

    sphere = new THREE.SphereGeometry( 100, 16, 8, 1 );
    lightMesh = new THREE.Mesh( sphere, new THREE.MeshBasicMaterial( { color: 0xffaa00 } ) );
    lightMesh.scale.set( 0.05, 0.05, 0.05 );
    lightMesh.position = pointLight.position;
    scene.add( lightMesh );
*/

    renderer = new THREE.WebGLRenderer({ antialias: true });
    //renderer = new THREE.CanvasRenderer();
    renderer.setSize( self.divWidth, self.divHeight );

    // Follow size
    // THREEx.WindowResize.bind(renderer, camera);

    container.appendChild( renderer.domElement )
	  renderer.domElement.addEventListener('mousedown', onMouseDown, false);
	  renderer.domElement.addEventListener('mouseup', onMouseUp, false);
	  renderer.domElement.addEventListener('mousemove', onMouseMove, false);
	  renderer.domElement.addEventListener('mousewheel', onMouseWheel, false);

    var x_middle = (dimension.x*resolution.x)/2.0 + translation.x,
        y_middle = (dimension.y*resolution.y)/2.0 + translation.y,
        z_middle = (dimension.z*resolution.z)/2.0 + translation.z;

    scale = 50./dimension.x;

    var coord = transform_coordinates([x_middle, y_middle, z_middle]);

    create_stackboundingbox(
            coord[0]*scale,
            coord[1]*scale,
            coord[2]*scale,
            dimension.x*resolution.x*scale,
            dimension.y*resolution.y*scale,
            dimension.z*resolution.z*scale
    );

    controls.target = new THREE.Vector3(coord[0]*scale,coord[1]*scale,coord[2]*scale);

  }

  function toggleOrthographic() {
      if( ortho ) {
          camera.toPerspective();
          ortho = false;
      } else {
          camera.toOrthographic();
          ortho = true;
      }
			self.render();
  }
  self.toggleOrthographic = toggleOrthographic;

  function getBBDimension()
  {
    return new THREE.Vector3(
      dimension.x*resolution.x*scale,
      dimension.y*resolution.y*scale,
      dimension.z*resolution.z*scale);
  }

  function getBBCenterTarget()
  {
    var x_middle = (dimension.x*resolution.x)/2.0 + translation.x,
        y_middle = (dimension.y*resolution.y)/2.0 + translation.y,
        z_middle = (dimension.z*resolution.z)/2.0 + translation.z,
        coord = transform_coordinates([x_middle, y_middle, z_middle]);
    return new THREE.Vector3(coord[0]*scale,coord[1]*scale,coord[2]*scale);
  }

  function XYView()
  {
    var pos = getBBCenterTarget(),
      dim = getBBDimension();
    controls.target = pos;
    camera.position.x = pos.x;
    camera.position.y = pos.y;
    camera.position.z = (dim.z/2)+100+pos.z;
    camera.up.set(0, 1, 0);
		self.render();
  }
  self.XYView = XYView;

  function XZView()
  {
    var pos = getBBCenterTarget(),
      dim = getBBDimension();
    controls.target = pos;
    camera.position.x = pos.x;
    camera.position.y = (dim.y/2)+150;
    camera.position.z = pos.z;
    camera.up.set(0, 0, -1);
		self.render();
  }
  self.XZView = XZView;

  function YZView()
  {
    var pos = getBBCenterTarget(),
      dim = getBBDimension();
    controls.target = pos;
    camera.position.x = (dim.x/2)+150;
    camera.position.y = pos.y;
    camera.position.z = pos.z;
    camera.up.set(0, 1, 0);
		self.render();
  }
  self.YZView = YZView;

  // credit: http://stackoverflow.com/questions/638948/background-color-hex-to-javascript-variable-jquery
  function rgb2hex(rgb) {
   rgb = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
   function hex(x) {
    return ("0" + parseInt(x).toString(16)).slice(-2);
   }
   return "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
  }

  function rgb2hex2(rgb) {
    rgb = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    function hex(x) {
      return ("0" + parseInt(x).toString(16)).slice(-2);
    }
    return "0x" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
  }

  var Skeleton = function( skeleton_data )
  {
    var self = this;
    var type, from_vector, to_vector, labelspheregeometry = new THREE.SphereGeometry( 130 * scale, 32, 32, 1);

    this.line_material = new Object();
    this.actorColor = [255, 255, 0];
    this.visible = true;
    this.id = skeleton_data.id;
    this.baseName = skeleton_data.baseName;
    this.line_material[connectivity_types[0]] = new THREE.LineBasicMaterial( { color: 0xffff00, opacity: 1.0, linewidth: 3 } );
    this.line_material[connectivity_types[1]] = new THREE.LineBasicMaterial( { color: 0xff0000, opacity: 1.0, linewidth: 6 } );
    this.line_material[connectivity_types[2]] = new THREE.LineBasicMaterial( { color: 0x00f6ff, opacity: 1.0, linewidth: 6 } );

    this.setActorVisibility = function( vis ) {
      console.log('actor visibility');
      self.visible = vis;
      self.visiblityCompositeActor( 0, vis );
      self.visiblityCompositeActor( 1, vis );
      self.visiblityCompositeActor( 2, vis );
    };

    this.setPreVisibility = function( vis ) {
      self.visiblityCompositeActor( 1, vis );
    };

    this.setPostVisibility = function( vis ) {
      self.visiblityCompositeActor( 2, vis );
    };

    this.translate = function( dx, dy, dz )
    {
      for ( var i=0; i<connectivity_types.length; ++i ) {
        if( dx ) {
          this.actor[connectivity_types[i]].translateX( dx );
        }
        if( dy ) {
          this.actor[connectivity_types[i]].translateY( dy );
        }
        if( dz ) {
          this.actor[connectivity_types[i]].translateZ( dz );
        }
      }
    }

    this.updateSkeletonColor = function() {
      console.log('update color', this.actorColor );
      this.actor[connectivity_types[0]].material.color.setRGB( this.actorColor[0]/255., this.actorColor[1]/255., this.actorColor[2]/255. );
      for ( var k in this.otherSpheres ) {
        this.otherSpheres[k].material.color.setRGB( this.actorColor[0]/255., this.actorColor[1]/255., this.actorColor[2]/255. );
      }
    }

    this.changeColor = function( value )
    {
      this.actorColor = value;
      this.updateSkeletonColor();
      $('#skeletonaction-changecolor-' + self.id).css("background-color", rgb2hex( 'rgb('+value[0]+','+value[1]+','+value[2]+')' ) );
    }

    this.removeActorFromScene = function()
    {
      for ( var i=0; i<connectivity_types.length; ++i ) {
        scene.removeObject( this.actor[connectivity_types[i]] );
      }
      for ( var k in this.labelSphere ) {
          scene.removeObject( this.labelSphere[k] );
      }
      for ( var k in this.otherSpheres ) {
        scene.removeObject( this.otherSpheres[k] );
      }
    }

    this.addCompositeActorToScene = function()
    {
      for ( var i=0; i<connectivity_types.length; ++i ) {
        scene.add( this.actor[connectivity_types[i]] );
      }
    }

    this.visiblityCompositeActor = function( type_index, visible )
    {
      this.actor[connectivity_types[type_index]].visible = visible;
      if( type_index === 0 ) {
          for ( var k in this.labelSphere ) {
              this.labelSphere[k].visible = visible;
          }
      }
    }

    this.getActorColorAsHTMLHex = function () {
      return rgb2hex( 'rgb('+this.actorColor[0]+','+
        this.actorColor[1]+','+
        this.actorColor[2]+')' );
    }

    this.getActorColorAsHex = function()
    {
      return parseInt( rgb2hex2( 'rgb('+this.actorColor[0]+','+
        this.actorColor[1]+','+
        this.actorColor[2]+')' ), 16);
    };

    this.initialize_objects = function()
    {
      this.original_vertices = null;
      this.original_connectivity = null;
      this.geometry = new Object();
      this.actor = new Object();
      this.geometry[connectivity_types[0]] = new THREE.Geometry();
      this.geometry[connectivity_types[1]] = new THREE.Geometry();
      this.geometry[connectivity_types[2]] = new THREE.Geometry();
      for ( var i=0; i<connectivity_types.length; ++i ) {
        this.actor[connectivity_types[i]] = new THREE.Line( this.geometry[connectivity_types[i]],
          this.line_material[connectivity_types[i]], THREE.LinePieces );
      }
      this.labelSphere = new Object();
      this.otherSpheres = new Object();
    }

    this.reinit_actor = function ( skeleton_data )
    {
      if( this.actor !== undefined  ) {
        self.removeActorFromScene();
      }
      self.initialize_objects();

      this.original_vertices = skeleton_data.vertices;
      this.original_connectivity = skeleton_data.connectivity;

      for (var fromkey in this.original_connectivity) {
        var to = this.original_connectivity[fromkey];
        for (var tokey in to) {

          type = connectivity_types[connectivity_types.indexOf(this.original_connectivity[fromkey][tokey]['type'])];
          var fv=transform_coordinates([
                   this.original_vertices[fromkey]['x'],
                   this.original_vertices[fromkey]['y'],
                   this.original_vertices[fromkey]['z']
              ]);
          from_vector = new THREE.Vector3(fv[0], fv[1], fv[2] );

          // transform
          from_vector.multiplyScalar( scale );

          this.geometry[type].vertices.push( new THREE.Vertex( from_vector ) );

          var tv=transform_coordinates([
                   this.original_vertices[tokey]['x'],
                   this.original_vertices[tokey]['y'],
                   this.original_vertices[tokey]['z']
              ]);
          to_vector = new THREE.Vector3(tv[0], tv[1], tv[2] );

          // transform
          // to_vector.add( translate_x, translate_y, translate_z );
          to_vector.multiplyScalar( scale );

          this.geometry[type].vertices.push( new THREE.Vertex( to_vector ) );

          // check if either from or to key vertex has a sphere associated with it
          var radiusFrom = parseFloat( this.original_vertices[fromkey]['radius'] );
          if( !(fromkey in this.otherSpheres) && radiusFrom > 0 ) {
            var radiusSphere = new THREE.SphereGeometry( radiusFrom * scale, 32, 32, 1);
            this.otherSpheres[fromkey] = new THREE.Mesh( radiusSphere, new THREE.MeshBasicMaterial( { color: this.getActorColorAsHex(), opacity:1.0, transparent:false  } ) );
            this.otherSpheres[fromkey].position.set( from_vector.x, from_vector.y, from_vector.z );
            scene.add( this.otherSpheres[fromkey] );
          }

          var radiusTo = parseFloat( this.original_vertices[tokey]['radius'] );
          if( !(tokey in this.otherSpheres) && radiusTo > 0 ) {
            var radiusSphere = new THREE.SphereGeometry( radiusTo * scale, 32, 32, 1);
            this.otherSpheres[tokey] = new THREE.Mesh( radiusSphere, new THREE.MeshBasicMaterial( { color: this.getActorColorAsHex(), opacity:1.0, transparent:false  } ) );
            this.otherSpheres[tokey].position.set( to_vector.x, to_vector.y, to_vector.z );
            scene.add( this.otherSpheres[tokey] );
          }

          // if either from or to have a relevant label, and they are not yet
          // created, create one
          if( ($.inArray( "uncertain", this.original_vertices[fromkey]['labels'] ) !== -1) && (this.labelSphere[fromkey]=== undefined) ) {
              this.labelSphere[fromkey] = new THREE.Mesh( labelspheregeometry, new THREE.MeshBasicMaterial( { color: 0xff8000, opacity:0.6, transparent:true  } ) );
              this.labelSphere[fromkey].position.set( from_vector.x, from_vector.y, from_vector.z );
              scene.add( this.labelSphere[fromkey] );
          }
          if( ($.inArray( "uncertain", this.original_vertices[tokey]['labels'] ) !== -1) && (this.labelSphere[tokey]=== undefined) ) {
              this.labelSphere[tokey] = new THREE.Mesh( labelspheregeometry, new THREE.MeshBasicMaterial( { color: 0xff8000, opacity:0.6, transparent:true  } ) );
              this.labelSphere[tokey].position.set( to_vector.x, to_vector.y, to_vector.z );
              scene.add( this.labelSphere[tokey] );
          }
          if( ($.inArray( "todo", this.original_vertices[fromkey]['labels'] ) !== -1) && (this.labelSphere[fromkey]=== undefined) ) {
              this.labelSphere[fromkey] = new THREE.Mesh( labelspheregeometry, new THREE.MeshBasicMaterial( { color: 0xff0000, opacity:0.6, transparent:true  } ) );
              this.labelSphere[fromkey].position.set( from_vector.x, from_vector.y, from_vector.z );
              scene.add( this.labelSphere[fromkey] );
          }
          if( ($.inArray( "todo", this.original_vertices[tokey]['labels'] ) !== -1) && (this.labelSphere[tokey]=== undefined) ) {
              this.labelSphere[tokey] = new THREE.Mesh( labelspheregeometry, new THREE.MeshBasicMaterial( { color: 0xff0000, opacity:0.6, transparent:true  } ) );
              this.labelSphere[tokey].position.set( to_vector.x, to_vector.y, to_vector.z );
              scene.add( this.labelSphere[tokey] );
          }
          if( ($.inArray( "soma", this.original_vertices[fromkey]['labels'] ) !== -1) && (this.labelSphere[fromkey]=== undefined) ) {
              this.labelSphere[fromkey] = new THREE.Mesh( labelspheregeometry, new THREE.MeshBasicMaterial( { color: 0xffff00 } ) );
              this.labelSphere[fromkey].position.set( from_vector.x, from_vector.y, from_vector.z );
              this.labelSphere[fromkey].scale.set( 2, 2, 2 );
              scene.add( this.labelSphere[fromkey] );
          }
          if( ($.inArray( "soma", this.original_vertices[tokey]['labels'] ) !== -1) && (this.labelSphere[tokey]=== undefined) ) {
              this.labelSphere[tokey] = new THREE.Mesh( labelspheregeometry, new THREE.MeshBasicMaterial( { color: 0xffff00  } ) );
              this.labelSphere[tokey].position.set( to_vector.x, to_vector.y, to_vector.z );
              this.labelSphere[tokey].scale.set( 2, 2, 2 );
              scene.add( this.labelSphere[tokey] );
          }

        }
      }
      this.updateSkeletonColor();
      this.addCompositeActorToScene();
    }

    self.reinit_actor( skeleton_data );

  }

  // array of skeletons
  var skeletons = new Object();

  // active node geometry
  var active_node;

  this.fullscreenWebGL = function()
  {
    var divID = 'view_in_3d_webgl_widget'; //'viewer-3d-webgl-canvas';
    if( THREEx.FullScreen.activated() ){
        var w = canvasWidth, h = canvasHeight;
        $('#viewer-3d-webgl-canvas').width(w);
        $('#viewer-3d-webgl-canvas').height(h);
        $('#viewer-3d-webgl-canvas').css("background-color", "#000000");
        renderer.setSize( w, h );
        THREEx.FullScreen.cancel();
    } else {
        THREEx.FullScreen.request(document.getElementById('viewer-3d-webgl-canvas'));
        var w = window.innerWidth, h = window.innerHeight;
        $('#viewer-3d-webgl-canvas').width(w);
        $('#viewer-3d-webgl-canvas').height(h);
        $('#viewer-3d-webgl-canvas').css("background-color", "#000000");
        renderer.setSize( w, h );
    }
		self.render();
  }

  self.resizeView = function (w, h) {
    if( renderer && !THREEx.FullScreen.activated() ) {
      $('#view_in_3d_webgl_widget').css('overflowY', 'hidden');
      var canvasWidth = w, canvasHeight = h;
      if( isNaN(h) && isNaN(w) ) {
        canvasHeight = 800;
        canvasWidth = 600;
      }
      // use 4:3
      if( isNaN(h) ) {
        canvasHeight = canvasWidth / 4 * 3;
      } else if( isNaN(w) ) {
        canvasHeight = canvasHeight - 100;
        canvasWidth = canvasHeight / 3 * 4;
      }
      $('#viewer-3d-webgl-canvas').width(canvasWidth-20);
      $('#viewer-3d-webgl-canvas').height(canvasHeight);
      $('#viewer-3d-webgl-canvas').css("background-color", "#000000");
      renderer.setSize( canvasWidth-20, canvasHeight );

      // resize list view, needs frame height to fill it
      var heightAvailable = $('#view_in_3d_webgl_widget').height() - canvasHeight;
      if( heightAvailable < 150 ) {
          $('#view-3d-webgl-skeleton-table-div').height(150);
      } else {
          $('#view-3d-webgl-skeleton-table-div').height(heightAvailable - 30);
      }
      self.render();
    }
  }

  self.createActiveNode = function()
  {
    if( !SkeletonAnnotations.getActiveNodeId() ) {
      // alert("You must have an active node selected to add its skeleton to the 3D WebGL View.");
      return;
    }
    sphere = new THREE.SphereGeometry( 160 * scale, 32, 32, 1 );
    active_node = new THREE.Mesh( sphere, new THREE.MeshBasicMaterial( { color: 0x00ff00, opacity:0.8, transparent:true } ) );
    active_node.position.set( 0,0,0 );
    scene.add( active_node );
    self.updateActiveNode();
    show_active_node = true;
  }

  this.removeActiveNode = function() {
    if(active_node) {
      scene.removeObject( active_node );
      active_node = null;
    }
  }

  this.updateActiveNode = function()
  {
    if(active_node) {
      var atn_pos = SkeletonAnnotations.getActiveNodePosition();
      if( atn_pos !== null) {
          var co = transform_coordinates( [
            translation.x + ((atn_pos.x) / project.focusedStack.scale) * resolution.x,
            translation.y + ((atn_pos.y) / project.focusedStack.scale) * resolution.y,
            translation.z + atn_pos.z * resolution.z]
          );
          active_node.position.set( co[0]*scale, co[1]*scale, co[2]*scale );
      }
    }
  }

  this.saveImage = function() {
      self.render();
      window.open(renderer.domElement.toDataURL("image/png"));
  }

  this.randomizeColors = function()
  {
    var i = 0, col;
    for( var skeleton_id in skeletons)
		{
      if( i < randomColors.length ) {
        col = randomColors[i];
      } else {
        col = [parseInt( Math.random() * 255 ),
          parseInt( Math.random() * 255 ),
          parseInt( Math.random() * 255 ) ];

      }
      i=i+1;
      skeletons[skeleton_id].changeColor( col );
    }
		self.render();
  }


  this.removeAllSkeletons = function() {
    for( var skeleton_id in skeletons)
    {
      if( skeletons.hasOwnProperty(skeleton_id) ) {
        self.removeSkeleton( skeleton_id );
      }
    }
		self.render();
  }

  this.getColorOfSkeleton = function( skeleton_id ) {
    if( skeleton_id in skeletons) {
      return skeletons[skeleton_id].getActorColorAsHTMLHex();
    } else {
      return '#FF0000';
    }
  }

  // add skeleton to scene
  this.addSkeleton = function( skeleton_id, skeleton_data )
  {
    if( skeletons.hasOwnProperty(skeleton_id) ){
      // skeleton already in the list, just reinitialize
      skeletons[skeleton_id].reinit_actor( skeleton_data );
      } else {
      skeleton_data['id'] = skeleton_id;
      skeletons[skeleton_id] = new Skeleton( skeleton_data );
      self.addSkeletonToTable( skeletons[skeleton_id] );
    }
    return true;
  }

  this.changeSkeletonColor = function( skeleton_id, value, color )
  {
    if( !skeletons.hasOwnProperty(skeleton_id) ){
        alert("Skeleton "+skeleton_id+" does not exist. Cannot change color!");
        return;
    } else {
        skeletons[skeleton_id].changeColor( value );
        $('#skeletonaction-changecolor-' + skeleton_id).css("background-color",color.hex);
				self.render();
        return true;
    }
  }

  // remove skeleton from scence
  this.removeSkeleton = function( skeleton_id )
  {
    if( !skeletons.hasOwnProperty(skeleton_id) ){
        $('#growl-alert').growlAlert({
          autoShow: true,
          content: "Skeleton "+skeleton_id+" does not exist. Cannot remove it!",
          title: 'Warning',
          position: 'top-right',
          delayTime: 2000,
          onComplete: function() {  }
        });
        return;
    } else {
        $('#skeletonrow-' + skeleton_id).remove();
        skeletons[skeleton_id].removeActorFromScene();
        delete skeletons[skeleton_id];
				self.render();
        return true;
    }
  }

  self.toggleBackground = function()
  {
      if( black_bg ) {
          renderer.setClearColorHex( 0xffffff, 1 );
          black_bg = false;
      } else {
          renderer.setClearColorHex( 0x000000, 1 );
          black_bg = true;
      }
			self.render();
  }

  self.toggleFloor = function()
  {
      if( floormesh.visible ) {
          // disable floor
          floormesh.visible = false;
      } else {
          // enable floor
          floormesh.visible = true;
      }
			self.render();
  }

  self.toggleBB = function()
  {
      if( bbmesh.visible ) {
          // disable floor
          bbmesh.visible = false;
          debugax.visible = false;
      } else {
          // enable floor
          bbmesh.visible = true;
          debugax.visible = true;
      }
			self.render();
  }

  function create_stackboundingbox(x, y, z, dx, dy, dz)
  {
    //console.log('bouding box', x, y, z, dx, dy, dz);
    var gg = new THREE.CubeGeometry( dx, dy, dz );
    var mm = new THREE.MeshBasicMaterial( { color: 0xff0000, wireframe: true } );
    bbmesh = new THREE.Mesh( gg, mm );
    bbmesh.position.set(x, y, z);
    scene.add( bbmesh );
  }

  function addMesh( geometry, scale, x, y, z, rx, ry, rz, material ) {
    var mesh = new THREE.Mesh( geometry, material );
    mesh.scale.set( scale, scale, scale );
    mesh.position.set( x, y, z );
    mesh.rotation.set( rx, ry, rz );
    mesh.doubleSided = true;
    meshes.push( mesh );
    scene.add( mesh );
	}

  function createScene( geometry, start ) {
    //addMesh( geometry, scale, 0, 0, 0,  0,0,0, new THREE.MeshPhongMaterial( { ambient: 0x030303, color: 0x030303, specular: 0x990000, shininess: 30 } ) );
    addMesh( geometry, scale, 0, 0, 0,  0,0,0, new THREE.MeshBasicMaterial( { color: 0xff0000, opacity:0.2 } ) ); // , transparent:true
	}

  function drawmesh() {
    var loader = new THREE.JSONLoader( true );
    var s = Date.now(),
        callback = function( geometry ) { createScene( geometry, s ) };
    jQuery.ajax({
        url: "dj/"+self.project_id+"/stack/"+self.stack_id+"/models",
        type: "GET",
        dataType: "json",
        success: function (models) {
          // loop over objects
          for( var obj in models) {
            var vert = models[obj].vertices;
            var vert2 = [];
            for ( var i = 0; i < vert.length; i+=3 ) {
              var fv = transform_coordinates([vert[i],vert[i+1],vert[i+2]]);
              vert2.push( fv[0] );
              vert2.push( fv[1] );
              vert2.push( fv[2] );
            }
            models[obj].vertices = vert2;
            loader.createModel( models[obj], callback );
          }
        }
      });
  }

  self.toggleMeshes = function() {
    if( show_meshes ) {
      for(var i=0; i<meshes.length; i++) {
        scene.remove( meshes[i] );
      }
      meshes = [];
      show_meshes = false;
    } else {
      // add them
      drawmesh();
      show_meshes = true;
    }
		self.render();
  }

  self.toggleActiveNode = function() {
    if( show_active_node ) {
      self.removeActiveNode();
      show_active_node = false;
    } else {
      self.createActiveNode();
      show_active_node = true;
    }
		self.render();
  }

  self.updateZPlane = function() {
    var zval;
    if( $('#enable_z_plane').attr('checked') != undefined ) {
      zval = project.focusedStack.z;
    } else {
      zval = -1;
    }
    // if disabled, deselect
    if( zval === -1 ) {
        scene.remove( zplane );
        zplane = null;
				self.render();
        return;
    }
    var newval;
    newval = (-zval * resolution.z - translation.z) * scale;
    if( zplane === null ) {
        var geometry = new THREE.Geometry();
        var xwidth = dimension.x*resolution.x*scale,
            ywidth = dimension.y*resolution.y*scale;
        geometry.vertices.push( new THREE.Vertex( new THREE.Vector3( 0,0,0 ) ) );
        geometry.vertices.push( new THREE.Vertex( new THREE.Vector3( xwidth,0,0 ) ) );
        geometry.vertices.push( new THREE.Vertex( new THREE.Vector3( 0,ywidth,0 ) ) );
        geometry.vertices.push( new THREE.Vertex( new THREE.Vector3( xwidth,ywidth,0 ) ) );
        geometry.faces.push( new THREE.Face4( 0, 1, 3, 2 ) );

        var material = new THREE.MeshBasicMaterial( { color: 0x151349 } );
        zplane = new THREE.Mesh( geometry, material );
        zplane.doubleSided = true;
        zplane.position.z = newval;
        scene.add( zplane );
				self.render();
        return;
    }
    zplane.position.z = newval;
		self.render();
    
  }

  function debugaxes() {
    debugax = new THREE.AxisHelper();
    debugax.position.set( -1, -1, 0 );
    debugax.scale.x = debugax.scale.y = debugax.scale.z = 0.1;
    scene.add( debugax );
  }

  function draw_grid() {
    // Grid
    var line_material = new THREE.LineBasicMaterial( { color: 0xffffff, opacity: 0.2 } ),
      geometry = new THREE.Geometry(),
      floor = 0, step = 25;
    for ( var i = 0; i <= 40; i ++ ) {
      geometry.vertices.push( new THREE.Vertex( new THREE.Vector3( - 500, floor, i * step - 500 ) ) );
      geometry.vertices.push( new THREE.Vertex( new THREE.Vector3(   500, floor, i * step - 500 ) ) );
      geometry.vertices.push( new THREE.Vertex( new THREE.Vector3( i * step - 500, floor, -500 ) ) );
      geometry.vertices.push( new THREE.Vertex( new THREE.Vector3( i * step - 500, floor,  500 ) ) );

    }
    floormesh = new THREE.Line( geometry, line_material, THREE.LinePieces );
    scene.add( floormesh );
  }

	/**
	// DISABLED: causes continuous refresh at a rate of 60 fps
  function animate() {
    requestAnimationFrame( animate );
    self.render();
  }
	*/

	function onMouseDown(event) {
		is_mouse_down = true;
	}
	function onMouseUp(event) {
		is_mouse_down = false;
	}

	/** To execute every time the mouse is moved. */
  function onMouseMove(event) {
    //var mouseX = ( event.clientX - self.divWidth );
    //var mouseY = ( event.clientY - self.divHeight );
		if (is_mouse_down) {
		  self.render();
		}
  }

	/** To execute every time the mouse is moved. */
	function onMouseWheel(event) {
		self.render();
	}

  self.render = function render() {
    controls.update();
    renderer.clear();
    renderer.render( scene, camera );
  }

  self.addSkeletonToTable = function ( skeleton ) {

    var rowElement = $('<tr/>').attr({
      id: 'skeletonrow-' + skeleton.id
    });
    // $('#webgl-skeleton-table > tbody:last').append( rowElement );
    $('#webgl-skeleton-table > tbody:last').append( rowElement );
    
    // show skeleton
    rowElement.append(
      $(document.createElement("td")).append(
        $(document.createElement("input")).attr({
                  id:    'skeletonshow-' + skeleton.id,
                  name:  skeleton.baseName,
                  value: skeleton.id,
                  type:  'checkbox',
                  checked:true
          })
          .click( function( event )
          {
            var vis = $('#skeletonshow-' + skeleton.id).is(':checked');
            skeletons[skeleton.id].setActorVisibility( vis );
            self.render();
          } )
    ));

    // show pre
    rowElement.append(
      $(document.createElement("td")).append(
        $(document.createElement("input")).attr({
                  id:    'skeletonpre-' + skeleton.id,
                  name:  skeleton.baseName,
                  value: skeleton.id,
                  type:  'checkbox',
                  checked:true
          })
          .click( function( event )
          {
            skeletons[skeleton.id].setPreVisibility( $('#skeletonpre-' + skeleton.id).is(':checked') );
            self.render();
          } )
    ));

    // show post
    rowElement.append(
      $(document.createElement("td")).append(
        $(document.createElement("input")).attr({
                  id:    'skeletonpost-' + skeleton.id,
                  name:  skeleton.baseName,
                  value: skeleton.id,
                  type:  'checkbox',
                  checked:true
          })
          .click( function( event )
          {
            skeletons[skeleton.id].setPostVisibility( $('#skeletonpost-' + skeleton.id).is(':checked') );
            self.render();
          } )
    ));

    var td = $(document.createElement("td"));
    td.append( $(document.createElement("img")).attr({
          id:    'skeletonaction-remove-' + skeleton.id,
          value: 'Remove'
          })
          .click( function( event )
          {
            self.removeSkeleton( skeleton.id );
          })
          .attr('src','widgets/themes/kde/delete.png')
          .text('Remove!')
    );
    td.append(
        $(document.createElement("button")).attr({
          id:    'skeletonaction-changecolor-' + skeleton.id,
          value: 'Change color'
          })
          .click( function( event )
          {
            $('#color-wheel-' + skeleton.id).toggle();
          })
          .text('Change color')
      );
    td.append(
      $('<div id="color-wheel-' +
        skeleton.id + '"><div class="colorwheel'+
        skeleton.id + '"></div></div>')
    );
    td.append( $(document.createElement("img")).attr({
      id:    'skeletonaction-activate-' + skeleton.id,
      value: 'Remove'
    })
      .click( function( event )
      {
          TracingTool.goToNearestInNeuron( 'skeleton', skeleton.id );
      })
      .attr('src','widgets/themes/kde/activate.gif')
    );
    rowElement.append( td );

    var cw = Raphael.colorwheel($("#color-wheel-"+skeleton.id+" .colorwheel"+skeleton.id)[0],150);
    cw.color("#FFFF00");
    $('#skeletonaction-changecolor-' + skeleton.id).css("background-color","#FFFF00");
    cw.onchange(function(color)
    {
      var colors = [parseInt(color.r), parseInt(color.g), parseInt(color.b)]
      self.changeSkeletonColor( skeleton.id, colors, color );
    })

    $('#color-wheel-' + skeleton.id).hide();

    rowElement.append(
      $(document.createElement("td")).text( skeleton.baseName + ' (SkeletonID: ' + skeleton.id + ')' )
    );

  }

  self.addActiveSkeletonToView = function() {
    var atn_id = SkeletonAnnotations.getActiveNodeId(),
        skeleton_id = SkeletonAnnotations.getActiveSkeletonId();
    if (!atn_id) {
      alert("You must have an active node selected to add its skeleton to the 3D WebGL View.");
      return;
    }
    if (SkeletonAnnotations.getActiveNodeType() != "treenode") {
      alert("You can only add skeletons to the 3D WebGL View at the moment - please select a node of a skeleton.");
      return;
    }
    self.addSkeletonFromID( project.id, skeleton_id ); // will call self.render()
  }

  self.addSkeletonFromID = function (projectID, skeletonID) {
    if( skeletonID !== undefined )
    {
        jQuery.ajax({
          url: django_url + project.id + '/skeleton/' + skeletonID + '/json',
          type: "GET",
          dataType: "json",
          success: function (skeleton_data) {
            skeleton_data['baseName'] = skeleton_data['neuron']['neuronname'];
            self.addSkeleton( parseInt(skeletonID), skeleton_data );
						self.render();
          }
        });
    }
  };

  self.getListOfSkeletonIDs = function(only_visible) {
    var keys = [];
    for( var skeleton_id in skeletons)
    {
        if( skeletons.hasOwnProperty(skeleton_id) ) {
          if(only_visible) {
            if(skeletons[skeleton_id].visible)
              keys.push( parseInt(skeleton_id) );
          } else {
            keys.push( parseInt(skeleton_id) );
          }
        }
    }
    return keys;
  };

  self.storeSkeletonList = function() {
    var shortname = prompt('Short name reference for skeleton list?'),
        description = prompt('Short description?');
    jQuery.ajax({
      url: django_url + project.id + '/skeletonlist/save',
      data: { shortname: shortname, description: description,
        skeletonlist: self.getListOfSkeletonIDs() },
      type: "POST",
      dataType: "json",
      success: function () {
      }
    });
  };

  self.loadSkeletonList = function() {
    var shortname = prompt('Short name reference?');
    jQuery.ajax({
      url: django_url + project.id + '/skeletonlist/load',
      data: { shortname: shortname },
      type: "POST",
      dataType: "json",
      success: function ( data ) {
        for( var idx in data['skeletonlist'])
        {
          self.addSkeletonFromID( self.project_id, data['skeletonlist'][idx] );
        }
      }
    });
  }

}
