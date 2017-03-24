/* -*- mode: espresso; espresso-indent-level: 8; indent-tabs-mode: t -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  var CACHE_TIMEOUT = 5*60*1000;  // 5 minutes
  var BASENAME = 'synapselabels.hdf5';  // todo: remove this

  var SynapseDetectionTable = function() {
    this.widgetID = this.registerInstance();
    this.idPrefix = `synapse-detection-table${this.widgetID}-`;

    var update = this.update.bind(this);

    /**
     * Skeleton source which is registered and other widgets can use
     */
    this.skeletonSource = new CATMAID.BasicSkeletonSource(this.getName(), {
      handleAddedModels: update,
      handleChangedModels: update,
      handleRemovedModels: update,
    });

    CATMAID.skeletonListSources.updateGUI();

    /**
     *  {
     *    skeletonID1: {
     *      'timestamp': timestamp,
     *     'rows': [
     *       {
     *           'detectedSynapseID': synID,
     *           'coords': {  // todo: stack or project coordinates?
     *             'x': x,
     *             'y': y,
     *             'z': z,
     *           },
     *           'sizePx': sum of all pixel counts,
     *           'slices': 1,
     *           'uncertainty': mean uncertainty across all slices, // todo: should be weighted by size
     *           'nodeID': first node encountered,  // todo: be smarter about picking a node
     *           'skelID': skeletonID
     *         },
     *         {... and so on}
     *       ]
     *    },
     *    skeletonID2: {
     *      'timestamp': timestamp,
     *     'rows': [rows]
     *    },
     *  }
     *
     * @type {{}}
     */
    this.cache = {};

    this.oTable = null;
  };

  $.extend(SynapseDetectionTable.prototype, new InstanceRegistry());

  SynapseDetectionTable.prototype.getName = function() {
    return 'Synapse Detection Table ' + this.widgetID;
  };

  SynapseDetectionTable.prototype.setSkelSourceText = function() {
    var count = this.skeletonSource.getNumberOfSkeletons();
    var element = document.getElementById(this.idPrefix + 'source-controls');
    element.title = `${count} skeleton${count === 1 ? '' : 's'} selected`;
  };

  var addToMean = function(existingValue, existingCount, newValue) {
    return (existingValue * existingCount + newValue) / (existingCount + 1);
  };

  /**
   * todo: replace this, please, god
   * @param synapseInfo
   */
  var synapseInfoToBboxProject = function(synapseInfo) {
    var xyRadius = Math.sqrt(synapseInfo.sizePx);
    var zRadius = Math.ceil(synapseInfo.slices / 2);

    var stack = project.getStackViewers()[0].primaryStack;
    var bounds = stack.createStackToProjectBox(
      {
        min: {
          x: synapseInfo.coords.x - xyRadius,
          y: synapseInfo.coords.y - xyRadius,
          z: synapseInfo.coords.z - zRadius
        },
        max: {
          x: synapseInfo.coords.x + xyRadius,
          y: synapseInfo.coords.y + xyRadius,
          z: synapseInfo.coords.z + zRadius
        }
      }
    );

    return {
      xmin: bounds.min.x,
      ymin: bounds.min.y,
      zmin: bounds.min.z,
      xmax: bounds.max.x,
      ymax: bounds.max.y,
      zmax: bounds.max.z,
    };
  };

  var connResponseToConnInfo = function(connResponse) {
    return {
      connID: connResponse[0],
      coords: {
        x: connResponse[1],
        y: connResponse[2],
        z: connResponse[3]
      },
      confidence: connResponse[4],
      userID: connResponse[6],
      treenodeID: connResponse[7]
    };
  };

  var connsResponseToConnInfos = function(connsResponse) {
    return connsResponse.map(connResponseToConnInfo);
  };

  /**
   * Draw an approximate bounding box around the given detected synapse and see if it intersects with any
   * manually traced connector.
   *
   * @param synapseInfo
   * @return Array of Promises of connInfo objects
   */
  SynapseDetectionTable.prototype.getIntersectingConnectors = function(synapseInfo) {
    var bbox = synapseInfoToBboxProject(synapseInfo);
    return CATMAID.fetch(project.id + '/connectors/intersecting/', 'GET', bbox)
      .then(connsResponseToConnInfos)
      .then(function(connInfos) {
        synapseInfo.intersectingConnectors = connInfos;
        return synapseInfo;
      });
  };

  /**
   * getIntersectingConnectors for many synapses at a time
   *
   * @param synapseInfosObj : object mapping synapse ID to synapseInfo object
   * @return Promise of object mapping synapse ID to array of connInfo objects
   */
  SynapseDetectionTable.prototype.getIntersectingConnectorsMany = function(synapseInfosObj) {
    var data = Object.keys(synapseInfosObj).reduce(function(obj, synID) {
      obj[synID] = JSON.stringify(synapseInfoToBboxProject(synapseInfosObj[synID]));
      return obj;
    }, {});

    return CATMAID.fetch(project.id + '/connectors/intersecting/many/', 'POST', data)
      .then(function(response) {
        return Object.keys(response).reduce(function(obj, synID){
          obj[synID] = connsResponseToConnInfos(response[synID]);
          return obj;
        }, {});
      });
  };

  SynapseDetectionTable.prototype.getSynapsesForSkel = function(skelID) {
    var self = this;

    if (this.cache[skelID] && Date.now() - this.cache[skelID] <= CACHE_TIMEOUT) {
      return this.cache[skelID].rows;
    }

    return CATMAID.fetch(project.id + '/skeleton/auto-synapses/', 'GET', {skid: skelID, basename: BASENAME})
      .then(function(response){
        var counts = {};
        var rowsObj = {};
        var slices = {};

        for (var responseRow of response) {
          var synID = responseRow.synapse_id;
          if (!counts[synID]) {
            counts[synID] = 1;
            slices[synID] = new Set([responseRow.z_px]);

            rowsObj[synID] = {
              detectedSynapseID: synID,
              coords: {  // todo: stack or project coordinates?
                x: responseRow.x_px,
                y: responseRow.y_px,
                z: responseRow.z_px,
              },
              sizePx: responseRow.size_px,
              slices: slices[synID].size,
              uncertainty: responseRow.detection_uncertainty,
              nodeID: responseRow.node_id,  // todo: be smarter about picking a node
              skelID: responseRow.skeleton_id,
              intersectingConnectors: null  // this is populated later
            };
          } else {
            rowsObj[synID].coords.x = addToMean(rowsObj[synID].coords.x, counts[synID], responseRow.x_px);
            rowsObj[synID].coords.y = addToMean(rowsObj[synID].coords.y, counts[synID], responseRow.y_px);
            rowsObj[synID].coords.z = addToMean(rowsObj[synID].coords.z, counts[synID], responseRow.z_px);
            rowsObj[synID].sizePx += responseRow.size_px;
            slices[synID].add(responseRow.z_px);
            rowsObj[synID].slices = slices[synID].size;
            rowsObj[synID].uncertainty = addToMean(rowsObj[synID].uncertainty, counts[synID], responseRow.detection_uncertainty);

            counts[synID] += 1;
          }
        }

        return self.getIntersectingConnectorsMany(rowsObj)
          .then(function(synInfosObj) {
            var rowsWithIntersecting = Object.keys(synInfosObj)
              .sort(function(a, b) {return a - b;})
              .map(function(synID) {
                rowsObj[synID].intersectingConnectors = synInfosObj[synID];
                return rowsObj[synID];
              });

            self.cache[skelID] = {
              timestamp: Date.now(),
              rows: rowsWithIntersecting
            };

            return rowsWithIntersecting;
          });
      });
  };

  SynapseDetectionTable.prototype.getWidgetConfiguration = function() {
    var self = this;
    var tableID = this.idPrefix + 'datatable';
    return {
      helpText: 'Synapse Detection Table widget: See automatically detected synapses for given skeleton(s)',
      controlsID: this.idPrefix + 'controls',
      createControls: function(controls) {
        var sourceControls = document.createElement('label');
        sourceControls.title = '0 skeletons selected';
        sourceControls.id = self.idPrefix + 'source-controls';
        controls.append(sourceControls);

        var sourceSelect = CATMAID.skeletonListSources.createSelect(this.skeletonSource,
          [this.skeletonSource.getName()]);
        sourceControls.appendChild(sourceSelect);

        var add = document.createElement('input');
        add.setAttribute("type", "button");
        add.setAttribute("value", "Add");
        add.onclick = function() {
          self.skeletonSource.loadSource.bind(self.skeletonSource)();
        };
        sourceControls.appendChild(add);

        var clear = document.createElement('input');
        clear.setAttribute("type", "button");
        clear.setAttribute("value", "Clear");
        clear.onclick = function() {
          Object.keys(self.cache).forEach(function(key){delete self.cache[key];});
          self.skeletonSource.clear();
        };
        sourceControls.appendChild(clear);

        var refresh = document.createElement('input');
        refresh.setAttribute("type", "button");
        refresh.setAttribute("value", "Refresh");
        refresh.onclick = function() {
          Object.keys(self.cache).forEach(function(key){delete self.cache[key];});
          self.update();
        };
        controls.appendChild(refresh);

      },
      contentID: this.idPrefix + 'content',
      createContent: function(container) {
        var self = this;

        container.innerHTML = `
          <table cellpadding="0" cellspacing="0" border="0" class="display" id="${tableID}"> 
            <thead> 
              <tr> 
                <th>detected synapse ID</th> 
                <th>skeleton ID 
                  <input type="text" name="searchSkelId" id="${self.idPrefix}search-skel-id" 
                    value="Search" class="search_init"/> 
                </th> 
                <th>uncertainty</th> 
                <th>size (px)</th> 
                <th>slices</th> 
                <th>intersecting connectors</th> 
              </tr> 
            </thead> 
            <tfoot> 
              <tr> 
                <th>detected synapse ID</th> 
                <th>skeleton ID</th> 
                <th>uncertainty</th> 
                <th>size (px)</th> 
                <th>slices</th> 
                <th>intersecting connectors</th> 
              </tr> 
            </tfoot> 
            <tbody> 
            </tbody> 
          </table>
        `;
      },
      init: function() {
        this.init(project.getId());
      }
    };
  };

  SynapseDetectionTable.prototype.init = function() {
    var self = this;
    var tableID = this.idPrefix + 'datatable';

    var $table = $('#' + tableID);

    this.oTable = $table.DataTable({
      // http://www.datatables.net/usage/options
      destroy: true,
      dom: '<"H"lrp>t<"F"ip>',
      serverSide: false,
      paging: true,
      lengthChange: true,
      autoWidth: false,
      pageLength: CATMAID.pageLengthOptions[0],
      lengthMenu: [CATMAID.pageLengthOptions, CATMAID.pageLengthLabels],
      jQueryUI: true,
      processing: true,
      deferRender: true,
      columns: [
        {
          data: 'detectedSynapseID',
          render: Math.floor,
          orderable: true,
          className: "center"
        },
        {
          data: 'skelID',
          render: Math.floor,
          orderable: true,
          searchable: true,
          className: "center"
        },
        {
          data: 'uncertainty',
          orderable: true,
          className: "center"
        },
        {
          data: 'sizePx',
          render: Math.floor,
          orderable: true,
          className: "center"
        },
        {
          data: 'slices',
          orderable: true,
          className: "center"
        },
        {
          data: 'intersectingConnectors',
          render: function(data, type, row, meta) {
            return data.length;
          },
          orderable: true,
          className: 'center'
        }
      ]
    });

    $(`#${self.idPrefix}search-input-label`).keydown(function (event) {
      // filter table by tag text on hit enter
      if (event.which == 13) {
        event.stopPropagation();
        event.preventDefault();
        // Filter with a regular expression
        var filter_searchtag = event.currentTarget.value;
        self.oTable
          .column(event.currentTarget.closest('th'))
          .search(filter_searchtag, true, false)
          .draw();
      }
    });

    var $headerInput = $table.find('thead input');

    // prevent sorting the column when focusing on the search field
    $headerInput.click(function (event) {
      event.stopPropagation();
    });

    // remove the 'Search' string when first focusing the search box
    $headerInput.focus(function () {
      if (this.className === "search_init") {
        this.className = "";
        this.value = "";
      }
    });

    $table.on("dblclick", "tbody tr", function() {
      var rowData = self.oTable.row(this).data();
      var coords = rowData.coords;

      var stackViewer = project.getStackViewers()[0];

      // todo: resolve offset

      stackViewer.moveToPixel(
        'z' in coords ? coords.z - 121 : stackViewer.z,
        'y' in coords ? coords.y : stackViewer.y,
        'x' in coords ? coords.x : stackViewer.x,
        's' in coords ? coords.s : stackViewer.s
      );

    });
  };

  SynapseDetectionTable.prototype.update = function() {
    var self = this;
    var startTime = Date.now();
    console.log('update started');
    this.oTable.clear();
    return Promise.all(
      this.skeletonSource
        .getSelectedSkeletons()
        .map(self.getSynapsesForSkel.bind(self))
    ).then(function(rowsArr) {
      for (var rowObjs of rowsArr) {
        self.oTable.rows.add(rowObjs);
      }
      self.setSkelSourceText();
      console.log(`update took ${(Date.now() - startTime)/1000}s`);
      console.log('drawing');
      self.oTable.draw();
    });
  };

  SynapseDetectionTable.prototype.destroy = function() {
    this.skeletonSource.destroy();
    this.unregisterInstance();
  };

  CATMAID.registerWidget({key: 'synapse-detection-table', creator: SynapseDetectionTable});

})(CATMAID);
