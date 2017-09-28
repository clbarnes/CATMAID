# -*- coding: utf-8 -*-
from __future__ import unicode_literals, division

import os
from contextlib import closing
import logging
import numpy as np
import base64
from django.conf import settings
from django.http import HttpResponse, JsonResponse

from catmaid.models import UserRole, TILE_SOURCE_TYPES
from catmaid.control.common import ConfigurationError
from catmaid.control.authentication import requires_user_role

from six import StringIO


logger = logging.getLogger(__name__)

tile_loading_enabled = True

try:
    import h5py
except ImportError:
    tile_loading_enabled = False
    logger.info("CATMAID was unable to load the h5py library, which is an "
          "optional dependency. HDF5 tiles are therefore disabled. To enable, "
          "install h5py.")
try:
    from PIL import Image
except ImportError:
    tile_loading_enabled = False
    logger.warning("CATMAID was unable to load the PIL/pillow library. "
          "HDF5 tiles are therefore disabled.")


@requires_user_role([UserRole.Browse])
def get_tile(request, project_id=None, stack_id=None):

    if not tile_loading_enabled:
        raise ConfigurationError("HDF5 tile loading is currently disabled")

    scale = float(request.GET.get('scale', '0'))
    height = int(request.GET.get('height', '0'))
    width = int(request.GET.get('width', '0'))
    x = int(request.GET.get('x', '0'))
    y = int(request.GET.get('y', '0'))
    z = int(request.GET.get('z', '0'))
    col = request.GET.get('col', 'y')
    row = request.GET.get('row', 'x')
    file_extension = request.GET.get('file_extension', 'hdf5')
    basename = request.GET.get('basename', 'raw')

    # need to know the stack name
    # fpath=os.path.join( settings.HDF5_STORAGE_PATH, '{0}_{1}_{2}.hdf'.format( project_id, stack_id, basename ) )
    outer_name, inner_path = basename.split('__')
    fpath=os.path.join(settings.HDF5_STORAGE_PATH, '{}_{}.{}'.format(project_id, outer_name, file_extension))

    if not os.path.exists( fpath ):
        data=np.zeros( (height, width) )
        pilImage = Image.frombuffer('RGBA',(width,height),data,'raw','L',0,1)
        response = HttpResponse(content_type="image/png")
        pilImage.save(response, "PNG")
        return response
        # return HttpResponse(json.dumps({'error': 'HDF5 file does not exists: {0}'.format(fpath)}))

    with closing(h5py.File(fpath, 'r')) as hfile:
        image_data = hfile[inner_path]
        data = np.array(image_data[z, y:y + height, x:x + width])

    intmax = np.iinfo(np.uint8).max
    img_arr = np.ones((height, width, 4), dtype=np.uint8)*intmax

    if 'label' in inner_path:
        # assume XY data, int>32
        # truncate data to make low-fidelity probably-not-unique labels
        uint8_data = data.view(np.uint8)
        stacked_uint8_data = uint8_data.reshape(data.shape + (data.dtype.itemsize, ))
        depth = min(3, data.dtype.itemsize)
        truncated_uint8_data = stacked_uint8_data[:, :, :depth]
        # todo: label mapping?
        img_arr[:, :, :depth] = truncated_uint8_data
    elif np.issubdtype(data.dtype, float):
        # assume XYC (RGB) data between 0 and 1
        img_arr[:, :, :3] = data[:, :, :3] * intmax

    # pil_image = Image.fromarray(truncated_uint8_data, mode='RGB')
    pil_image = Image.fromarray(img_arr, mode='RGBA')

    # pil_image = Image.frombuffer('RGBA', (width, height), img_arr, 'raw', 'RGBA', 0, 1)
    # np.save(os.path.join(settings.HDF5_STORAGE_PATH, '{}-{}-{}_split.npy'.format(x, y, z)), img_arr)
    # pil_image.save(os.path.join(settings.HDF5_STORAGE_PATH, '{}-{}-{}.png'.format(x, y, z)))
    response = HttpResponse(content_type="image/png")
    response['access-control-allow-origin'] = '*'
    pil_image.save(response, "PNG")
    return response


@requires_user_role([UserRole.Annotate])
def put_tile(request, project_id=None, stack_id=None):
    """ Store labels to HDF5 """

    if not tile_loading_enabled:
        raise ConfigurationError("HDF5 tile loading is currently disabled")

    scale = float(request.POST.get('scale', '0'))
    height = int(request.POST.get('height', '0'))
    width = int(request.POST.get('width', '0'))
    x = int(request.POST.get('x', '0'))
    y = int(request.POST.get('y', '0'))
    z = int(request.POST.get('z', '0'))
    col = request.POST.get('col', 'y')
    row = request.POST.get('row', 'x')
    image = request.POST.get('image', 'x')

    fpath=os.path.join( settings.HDF5_STORAGE_PATH, '{0}_{1}.hdf'.format( project_id, stack_id ) )

    with closing(h5py.File(fpath, 'a')) as hfile:
        hdfpath = '/labels/scale/' + str(int(scale)) + '/data'
        image_from_canvas = np.asarray( Image.open( StringIO(base64.decodestring(image)) ) )
        hfile[hdfpath][y:y+height,x:x+width,z] = image_from_canvas[:,:,0]

    return HttpResponse("Image pushed to HDF5.", content_type="plain/text")


class TileSource(object):

    def get_canaray_url(self, mirror):
        """Get the canarary URL for this mirror.
        """
        loc = mirror.stack.canary_location
        col = int(loc.x / mirror.tile_width)
        row = int(loc.y / mirror.tile_height)
        return self.get_tile_url(mirror, (col, row, loc.z))


class DefaultTileSource(TileSource):
    """ Creates the full path to the tile at the specified coordinate index for
    tile source type 1.
    """

    description = "File-based image stack"

    def get_tile_url(self, mirror, tile_coords, zoom_level=0):
        path = mirror.image_base
        n_coords = len(tile_coords)
        for c in range( 2, n_coords ):
            # the path is build beginning with the last component
            coord = tile_coords[n_coords - c + 1]
            path += str(coord) + "/"
        path += "%s_%s_%s.%s" % (tile_coords[1], tile_coords[0],
                zoom_level, mirror.file_extension)
        return path


class BackslashTileSource(TileSource):
    """ Creates the full path to the tile at the specified coordinate index for
    tile source type 4.
    """

    description = "File-based image stack with zoom level directories"

    def get_tile_url(self, mirror, tile_coords, zoom_level=0):
        path = mirror.image_base
        n_coords = len(tile_coords)
        for c in range( 2, n_coords ):
            # the path is build beginning with the last component
            coord = tile_coords[n_coords - c + 1]
            path += str(coord) + "/"
        path += "%s/%s_%s.%s" % (zoom_level, tile_coords[1],
                tile_coords[0], mirror.file_extension)
        return path


class LargeDataTileSource(TileSource):
    """ Creates the full path to the tile at the specified coordinate index
    for tile source type 5.
    """

    description = "Directory-based image stack"

    def get_tile_url(self, mirror, tile_coords, zoom_level=0):
        path = "%s%s/" % (mirror.image_base, zoom_level)
        n_coords = len(tile_coords)
        for c in range( 2, n_coords ):
            # the path is build beginning with the last component
            coord = tile_coords[n_coords - c + 1]
            path += str(coord) + "/"
        path += "%s/%s.%s" % (tile_coords[1], tile_coords[0],
            mirror.file_extension)
        return path


tile_source_map = {
    1: DefaultTileSource,
    4: BackslashTileSource,
    5: LargeDataTileSource
}

def get_tile_source(type_id):
    """Get a tile source instance for a type ID.
    """
    if type_id not in tile_source_map:
        raise ValueError("Tile source type {} is unknown".format(type_id))
    return tile_source_map[type_id]()
